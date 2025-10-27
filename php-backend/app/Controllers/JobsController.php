<?php
namespace App\Controllers;

use App\Services\DB;

class JobsController
{
    private static function ensureSchema(): void
    {
        $pdo = DB::conn();
        // Ensure listing drafts and images tables exist (shared with ListingsController)
        $pdo->exec("
          CREATE TABLE IF NOT EXISTS listing_drafts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            main_category TEXT NOT NULL,
            title TEXT NOT NULL,
            description TEXT NOT NULL,
            structured_json TEXT,
            seo_title TEXT,
            seo_description TEXT,
            seo_keywords TEXT,
            seo_json TEXT,
            resume_file_url TEXT,
            owner_email TEXT,
            created_at TEXT NOT NULL,
            enhanced_description TEXT,
            wanted_tags_json TEXT,
            employee_profile INTEGER DEFAULT 0
          )
        ");
        $pdo->exec("CREATE TABLE IF NOT EXISTS listing_draft_images (id INTEGER PRIMARY KEY AUTOINCREMENT, draft_id INTEGER NOT NULL, path TEXT NOT NULL, original_name TEXT NOT NULL)");
        // Ensure employee_profile on listings exists
        $cols = DB::all("PRAGMA table_info(listings)");
        $names = array_map(fn($c) => $c['name'], $cols);
        if (!in_array('employee_profile', $names, true)) {
            $pdo->exec("ALTER TABLE listings ADD COLUMN employee_profile INTEGER NOT NULL DEFAULT 0");
        }
    }

    private static function ensureUploadsDir(): string
    {
        $uploads = __DIR__ . '/../../../data/uploads';
        if (!is_dir($uploads)) @mkdir($uploads, 0775, true);
        return realpath($uploads) ?: $uploads;
    }

    public static function employeeDraft(): void
    {
        self::ensureSchema();

        $ownerEmail = strtolower(trim((string)($_SERVER['HTTP_X_USER_EMAIL'] ?? '')));
        if (!$ownerEmail) { \json_response(['error' => 'Missing user email'], 400); return; }

        $name = trim((string)($_POST['name'] ?? ''));
        $targetTitle = trim((string)($_POST['target_title'] ?? ''));
        $summary = trim((string)($_POST['summary'] ?? ''));
        $location = trim((string)($_POST['location'] ?? ''));
        $phone = trim((string)($_POST['phone'] ?? ''));
        $subCategory = trim((string)($_POST['sub_category'] ?? ''));
        $subCategoryCustom = trim((string)($_POST['sub_category_custom'] ?? ''));

        if ($name === '' || $targetTitle === '' || $summary === '') {
            \json_response(['error' => 'name, target_title, and summary are required.'], 400);
            return;
        }
        if (mb_strlen($name) > 120 || mb_strlen($targetTitle) > 120) {
            \json_response(['error' => 'Name/Target Title too long.'], 400);
            return;
        }
        if (mb_strlen($summary) < 10 || mb_strlen($summary) > 5000) {
            \json_response(['error' => 'Summary must be between 10 and 5000 characters.'], 400);
            return;
        }
        if ($location === '') {
            \json_response(['error' => 'Location is required'], 400);
            return;
        }
        if (!preg_match('/^\+94\d{9}$/', $phone)) {
            \json_response(['error' => 'Phone must be in +94XXXXXXXXX format'], 400);
            return;
        }

        $sub = $subCategory ?: $subCategoryCustom;
        if (strtolower($subCategory) === 'other' && $subCategoryCustom) {
            $sub = $subCategoryCustom;
        }
        if ($sub === '') {
            \json_response(['error' => 'Please specify a Job sub-category (e.g., Driver, IT/Software, Sales/Marketing).'], 400);
            return;
        }

        // Enforce one active employee profile per email (approved/active or pending), allow a single draft at a time
        $nowIso = gmdate('c');
        $active = DB::one("
          SELECT id FROM listings
          WHERE LOWER(owner_email) = LOWER(?) AND employee_profile = 1
            AND status != 'Archived' AND (valid_until IS NULL OR valid_until > ?)
          LIMIT 1
        ", [$ownerEmail, $nowIso]);
        if ($active && !empty($active['id'])) {
            \json_response(['error' => 'You can upload a maximum of 1 Employee Profile per email.'], 400);
            return;
        }
        $existingDraft = DB::one("
          SELECT id FROM listing_drafts
          WHERE LOWER(owner_email) = LOWER(?) AND employee_profile = 1
          ORDER BY created_at DESC
          LIMIT 1
        ", [$ownerEmail]);
        if ($existingDraft && !empty($existingDraft['id'])) {
            \json_response(['ok' => true, 'draftId' => (int)$existingDraft['id'], 'reused' => true]);
            return;
        }

        // Optional image upload (accept up to 2 images)
        $uploadsDir = self::ensureUploadsDir();
        $possibleFileKeys = ['images', 'images[]', 'image', 'photos', 'files'];
        $filesArr = [];
        foreach ($possibleFileKeys as $k) {
            if (!isset($_FILES[$k])) continue;
            $f = $_FILES[$k];
            if (is_array($f) && isset($f['tmp_name'])) {
                if (is_array($f['tmp_name'])) {
                    $count = count($f['tmp_name']);
                    for ($i = 0; $i < $count && count($filesArr) < 2; $i++) {
                        if (empty($f['tmp_name'][$i]) || (isset($f['error'][$i]) && (int)$f['error'][$i] !== UPLOAD_ERR_OK)) continue;
                        $filesArr[] = [
                            'tmp_name' => $f['tmp_name'][$i],
                            'name' => is_array($f['name']) ? ($f['name'][$i] ?? ('image-' . ($i + 1))) : ($f['name'] ?? ('image-' . ($i + 1))),
                            'type' => is_array($f['type']) ? ($f['type'][$i] ?? 'application/octet-stream') : ($f['type'] ?? 'application/octet-stream'),
                            'size' => is_array($f['size']) ? (int)($f['size'][$i] ?? 0) : (int)($f['size'] ?? 0),
                            'error' => is_array($f['error']) ? (int)($f['error'][$i] ?? UPLOAD_ERR_OK) : (int)($f['error'] ?? UPLOAD_ERR_OK),
                        ];
                    }
                } else {
                    if (!empty($f['tmp_name']) && (int)($f['error'] ?? UPLOAD_ERR_OK) === UPLOAD_ERR_OK) {
                        $filesArr[] = [
                            'tmp_name' => $f['tmp_name'],
                            'name' => $f['name'] ?? 'image-1',
                            'type' => $f['type'] ?? 'application/octet-stream',
                            'size' => (int)($f['size'] ?? 0),
                            'error' => (int)($f['error'] ?? UPLOAD_ERR_OK),
                        ];
                    }
                }
            }
            if (!empty($filesArr)) break;
        }

        // Validate files (if any)
        if (!empty($filesArr)) {
            if (count($filesArr) > 2) {
                \json_response(['error' => 'Too many images. Max 2.'], 400);
                return;
            }
            foreach ($filesArr as $f) {
                if ($f['size'] > 5 * 1024 * 1024) { \json_response(['error' => 'File ' . ($f['name'] ?? '') . ' exceeds 5MB.'], 400); return; }
                if (strpos((string)$f['type'], 'image/') !== 0) { \json_response(['error' => 'File ' . ($f['name'] ?? '') . ' is not an image.'], 400); return; }
            }
        }

        // Process images best-effort (convert to webp)
        $stored = [];
        foreach ($filesArr as $f) {
            if (!is_uploaded_file($f['tmp_name'])) continue;
            $base = bin2hex(random_bytes(8));
            $destWebp = $uploadsDir . '/' . $base . '.webp';
            $final = null;
            try {
                if (class_exists('Imagick')) {
                    $img = new \Imagick($f['tmp_name']);
                    $img->setImageFormat('webp');
                    $img->resizeImage(2000, 0, \Imagick::FILTER_LANCZOS, 1, true);
                    $img->writeImage($destWebp);
                    $img->clear(); $img->destroy();
                    $final = $destWebp;
                } elseif (function_exists('imagewebp')) {
                    $mime = mime_content_type($f['tmp_name']) ?: '';
                    if (str_contains($mime, 'png')) $im = imagecreatefrompng($f['tmp_name']);
                    else $im = @imagecreatefromjpeg($f['tmp_name']);
                    if ($im !== false) {
                        $w = imagesx($im); $h = imagesy($im);
                        $newW = min(2000, $w);
                        $newH = (int) round($h * ($newW / max(1, $w)));
                        $dst = imagecreatetruecolor($newW, $newH);
                        imagecopyresampled($dst, $im, 0, 0, 0, 0, $newW, $newH, $w, $h);
                        imagewebp($dst, $destWebp, 90);
                        imagedestroy($dst); imagedestroy($im);
                        $final = $destWebp;
                    }
                }
            } catch (\Throwable $e) { /* ignore */ }

            if ($final === null) {
                // Fallback copy
                $ext = '.jpg';
                $mime = mime_content_type($f['tmp_name']) ?: '';
                if (str_contains($mime, 'png')) $ext = '.png';
                elseif (str_contains($mime, 'webp')) $ext = '.webp';
                $dest = $uploadsDir . '/' . $base . $ext;
                if (!@move_uploaded_file($f['tmp_name'], $dest)) { @copy($f['tmp_name'], $dest); }
                $final = $dest;
            }
            $stored[] = ['path' => $final, 'original_name' => pathinfo($final, PATHINFO_BASENAME)];
        }

        // Build structured JSON manually
        $structuredObj = [
            'sub_category' => $sub,
            'location' => $location,
            'phone' => $phone
        ];
        $structuredJSON = json_encode($structuredObj, JSON_PRETTY_PRINT);

        // Basic SEO
        $seoTitle = mb_substr("{$name} - {$targetTitle}", 0, 60);
        $seoDescription = mb_substr($summary, 0, 160);
        $seoKeywords = "{$targetTitle}, resume, {$name}";
        $seoJson = json_encode(['seo_title' => $seoTitle, 'meta_description' => $seoDescription, 'seo_keywords' => $seoKeywords], JSON_PRETTY_PRINT);

        $ts = gmdate('c');
        $resumeUrl = !empty($stored) ? ('/uploads/' . basename($stored[0]['path'])) : null;

        DB::exec("
          INSERT INTO listing_drafts (main_category, title, description, structured_json, seo_title, seo_description, seo_keywords, seo_json, resume_file_url, owner_email, created_at, employee_profile)
          VALUES ('Job', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
        ", ["{$name} • {$targetTitle}", $summary, $structuredJSON, $seoTitle, $seoDescription, $seoKeywords, $seoJson, $resumeUrl, $ownerEmail, $ts]);

        $draftId = DB::lastInsertId();

        // Store images (if any) for preview
        foreach ($stored as $s) {
            DB::exec("INSERT INTO listing_draft_images (draft_id, path, original_name) VALUES (?, ?, ?)", [$draftId, $s['path'], $s['original_name']]);
        }

        \json_response(['ok' => true, 'draftId' => $draftId]);
    }
}