<?php
namespace App\Services;

class GeminiService
{
    private static function callGemini(string $key, string $rolePrompt, string $userText): ?string
    {
        $model = 'models/gemini-2.5-flash-lite';
        $url = 'https://generativelanguage.googleapis.com/v1/' . $model . ':generateContent?key=' . urlencode($key);
        $body = [
            'contents' => [[ 'role' => 'user', 'parts' => [[ 'text' => $rolePrompt . "\n\nUser Input:\n" . $userText ]] ]],
            'generationConfig' => ['temperature' => 0.2, 'topK' => 1, 'topP' => 1, 'maxOutputTokens' => 2048]
        ];
        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_POST => true,
            CURLOPT_HTTPHEADER => ['Content-Type: application/json'],
            CURLOPT_POSTFIELDS => json_encode($body),
            CURLOPT_TIMEOUT => 4,
            CURLOPT_CONNECTTIMEOUT => 3
        ]);
        $resp = curl_exec($ch);
        $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);
        if ($code >= 200 && $code < 300 && $resp) {
            $data = json_decode($resp, true);
            $text = $data['candidates'][0]['content']['parts'][0]['text'] ?? '';
            if ($text) {
                $cleaned = preg_replace('/^```json\s*/i', '', $text);
                $cleaned = preg_replace('/```$/', '', $cleaned);
                return trim($cleaned);
            }
        }
        return null;
    }

    public static function generateDescription(string $category, string $title, string $description, array $structured = []): string
    {
        $key = getenv('GEMINI_API_KEY') ?: '';
        $role = "You are writing an appealing, concise listing description for a marketplace.\n"
              . "Requirements:\n"
              . "- 70–150 words, friendly and clear.\n"
              . "- Include 2–4 relevant emojis to improve readability (e.g., 🚗🏠💼📱🔧✨✅📍☎️).\n"
              . "- Start with a short enticing summary line.\n"
              . "- Use short bullet points (•) for key specs available.\n"
              . "- Bold short labels (e.g., **Location**:, **Condition**:, **Model**:, **Year**:, **Price**: if present).\n"
              . "- Do NOT hallucinate: only include values present in the input JSON.\n"
              . "- If price is missing, do not fabricate it.\n"
              . "- End with a short call to action and include phone if present.\n"
              . "Return plain text/markdown only.";
        $input = [
            'category' => $category,
            'title' => $title,
            'description' => $description,
            'structured' => $structured
        ];
        if ($key) {
            $out = self::callGemini($key, $role, json_encode($input, JSON_UNESCAPED_UNICODE));
            if ($out) {
                return $out;
            }
        }
        $sj = $structured;
        $lines = [];
        $lines[] = "✨ " . trim($title ?: 'Great deal available!');
        $bullets = [];
        if (!empty($sj['location'])) $bullets[] = "**Location**: " . $sj['location'] . " 📍";
        if (!empty($sj['condition'])) $bullets[] = "**Condition**: " . $sj['condition'] . " ✅";
        if (!empty($sj['model_name'])) $bullets[] = "**Model**: " . $sj['model_name'] . " 🔧";
        if (!empty($sj['manufacture_year'])) $bullets[] = "**Year**: " . $sj['manufacture_year'];
        if (isset($sj['price']) && $sj['price'] !== null && $sj['price'] !== '') $bullets[] = "**Price**: " . $sj['price'];
        if (!empty($bullets)) {
            foreach ($bullets as $b) $lines[] = "• " . $b;
        }
        $lines[] = trim($description) ? trim($description) : "Clean and well-maintained. Great value! 🚀";
        if (!empty($sj['phone'])) $lines[] = "☎️ " . $sj['phone'];
        return implode("\n", $lines);
    }

    public static function classifyMainCategory(string $title, string $description): string
    {
        $key = getenv('GEMINI_API_KEY') ?: '';
        $allowed = ['Vehicle','Property','Job','Electronic','Mobile','Home Garden','Other'];

        if ($key) {
            $role = "Classify the following listing into exactly one main category from the allowed list.\nAllowed categories:\n- Vehicle\n- Property\n- Job\n- Electronic\n- Mobile\n- Home Garden\n- Other\nReturn ONLY the category label.";
            $input = "Title: {$title}\nDescription:\n{$description}";
            $out = self::callGemini($key, $role, $input);
            $raw = strtolower(trim($out ?? ''));
            foreach ($allowed as $cat) {
                if ($raw === strtolower($cat)) return $cat;
            }
            foreach ($allowed as $cat) {
                if (str_contains($raw, strtolower($cat))) return $cat;
            }
        }

        $t = strtolower($title . ' ' . $description);
        if (preg_match('/(car|bike|motor|suv|van|bus|toyota|honda|nissan|kawasaki|yamaha)/i', $t)) return 'Vehicle';
        if (preg_match('/(house|apartment|land|property|annex|room|rent|lease)/i', $t)) return 'Property';
        if (preg_match('/(job|vacancy|hiring|position|salary|cv|resume)/i', $t)) return 'Job';
        if (preg_match('/(phone|iphone|android|samsung|pixel|mobile)/i', $t)) return 'Mobile';
        if (preg_match('/(tv|television|fridge|refrigerator|washer|laptop|camera|electronic|speaker|headphone)/i', $t)) return 'Electronic';
        if (preg_match('/(garden|home|furniture|sofa|bed|kitchen|decor|lawn|tools)/i', $t)) return 'Home Garden';
        return 'Other';
    }

    public static function extractStructured(string $category, string $title, string $description): array
    {
        $key = getenv('GEMINI_API_KEY') ?: '';
        $role = "Extract a compact JSON with fields: location, price, pricing_type, phone, model_name, manufacture_year, sub_category. Keep unknown fields empty or null.";
        $input = json_encode(['category' => $category, 'title' => $title, 'description' => $description], JSON_UNESCAPED_UNICODE);

        $out = $key ? (self::callGemini($key, $role, $input) ?? '{}') : '{}';
        $obj = json_decode($out, true);
        if (!is_array($obj)) $obj = [];

        $s = $obj;

        $t = $title . " \n" . $description;
        $tLower = strtolower($t);

        $phone = trim((string)($s['phone'] ?? ''));
        if (!$phone) {
            if (preg_match('/\+94\d{9}/', $t, $m)) {
                $phone = $m[0];
            } elseif (preg_match('/\b0\d{9}\b/', $t, $m)) {
                $phone = '+94' . substr($m[0], 1);
            }
        }
        $s['phone'] = $phone;

        $price = $s['price'] ?? null;
        $hasCurrencyCue = (bool)preg_match('/\b(rs|රු|lkr|price)\b/i', $t);
        if ($price === null || $price === '' || (is_string($price) && trim($price) === '')) {
            if (preg_match('/\b(?:rs|රු|lkr|price)[:\s]*([0-9][0-9,\.]*)\s*(k|lakh|lak)?/i', $t, $m)) {
                $numStr = str_replace(',', '', $m[1]);
                $base = (float)$numStr;
                $mul = 1.0;
                $unit = strtolower($m[2] ?? '');
                if ($unit === 'k') $mul = 1000.0;
                elseif ($unit === 'lakh' || $unit === 'lak') $mul = 100000.0;
                $price = $base * $mul;
            } elseif (preg_match('/\b([0-9]+(?:\.[0-9]+)?)\s*(k|lakh|lak)\b/i', $t, $m)) {
                $base = (float)$m[1];
                $mul = strtolower($m[2]) === 'k' ? 1000.0 : 100000.0;
                $price = $base * $mul;
            } elseif ($hasCurrencyCue && preg_match('/\b([0-9][0-9,]{3,})\b/', $t, $m)) {
                $price = (float) str_replace(',', '', $m[1]);
            } else {
                $price = null;
            }
        }
        if (is_string($price)) {
            $raw = strtolower(trim($price));
            if (preg_match('/^([0-9]+(?:\.[0-9]+)?)\s*k$/', $raw, $m)) $price = (float)$m[1] * 1000;
            elseif (preg_replace('/[^0-9.]/', '', $raw) !== '') $price = (float) preg_replace('/[^0-9.]/', '', $raw);
            else $price = null;
        }
        if (is_numeric($price)) {
            $p = (float)$price;
            if (($p >= 1950 && $p <= 2100) || (!$hasCurrencyCue && $p <= 3000)) {
                $price = null;
            }
        }
        $s['price'] = is_numeric($price) ? (float)$price : null;

        $pt = strtolower(trim((string)($s['pricing_type'] ?? '')));
        if ($pt) {
            if (str_contains($pt, 'nego')) $pt = 'Negotiable';
            elseif (str_contains($pt, 'fixed')) $pt = 'Fixed Price';
        } else {
            $pt = 'Negotiable';
        }
        $s['pricing_type'] = $pt;

        $yr = $s['manufacture_year'] ?? ($s['year'] ?? null);
        if (!$yr) {
            if (preg_match('/\b(19[5-9][0-9]|20[0-9]{2}|2100)\b/', $t, $m)) {
                $yr = (int)$m[1];
            }
        } elseif (is_string($yr)) {
            $num = (int) preg_replace('/[^0-9]/', '', $yr);
            $yr = ($num >= 1950 && $num <= 2100) ? $num : null;
        } elseif (!is_int($yr)) {
            $yr = null;
        }
        $s['manufacture_year'] = $yr;

        if (isset($s['price']) && is_numeric($s['price']) && $yr && abs((float)$s['price'] - (int)$yr) <= 1) {
            $s['price'] = null;
        }

        $model = trim((string)($s['model_name'] ?? ($s['model'] ?? '')));
        if ($model === '') {
            $brands = ['toyota','honda','nissan','suzuki','hyundai','kia','mazda','mitsubishi','bmw','mercedes','audi','lexus','apple','samsung','xiaomi','oppo','vivo','realme','nokia','oneplus','google','dell','hp','lenovo','asus','acer','canon','nikon','sony','panasonic'];
            foreach ($brands as $b) {
                if (preg_match('/\b(' . preg_quote($b, '/') . ')\s+([A-Za-z0-9\- ]{2,})/i', $t, $m)) {
                    $cand = trim($m[1] . ' ' . $m[2]);
                    $model = substr($cand, 0, 50);
                    break;
                }
            }
        }
        $s['model_name'] = $model;

        $sub = trim((string)($s['sub_category'] ?? ''));
        if ($sub === '') {
            if ($category === 'Vehicle') {
                if (preg_match('/\b(bike|motorcycle|scooter)\b/i', $tLower)) $sub = 'Bike';
                elseif (preg_match('/\b(car|sedan|hatchback|suv)\b/i', $tLower)) $sub = 'Car';
                elseif (preg_match('/\b(van)\b/i', $tLower)) $sub = 'Van';
                elseif (preg_match('/\b(bus)\b/i', $tLower)) $sub = 'Bus';
            } elseif ($category === 'Mobile') {
                if (preg_match('/\b(phone|smartphone|iphone|android)\b/i', $tLower)) $sub = 'Smartphone';
                elseif (preg_match('/\b(tablet|ipad)\b/i', $tLower)) $sub = 'Tablet';
                elseif (preg_match('/\b(watch)\b/i', $tLower)) $sub = 'Smartwatch';
            } elseif ($category === 'Electronic') {
                if (preg_match('/\b(laptop|notebook|macbook)\b/i', $tLower)) $sub = 'Laptop';
                elseif (preg_match('/\b(desktop|pc)\b/i', $tLower)) $sub = 'Desktop';
                elseif (preg_match('/\b(tv|television)\b/i', $tLower)) $sub = 'TV';
                elseif (preg_match('/\b(camera|dslr)\b/i', $tLower)) $sub = 'Camera';
                elseif (preg_match('/\b(audio|speaker|headphone|earbud)\b/i', $tLower)) $sub = 'Audio';
                elseif (preg_match('/\b(fridge|refrigerator|washing machine|microwave)\b/i', $tLower)) $sub = 'Appliances';
            } elseif ($category === 'Property') {
                if (preg_match('/\b(house|home)\b/i', $tLower)) $sub = 'House';
                elseif (preg_match('/\b(apartment|flat)\b/i', $tLower)) $sub = 'Apartment';
                elseif (preg_match('/\b(land|plot|acre|perch)\b/i', $tLower)) $sub = 'Land';
                elseif (preg_match('/\b(room|annex)\b/i', $tLower)) $sub = 'Room/Annex';
                elseif (preg_match('/\b(shop|office|commercial)\b/i', $tLower)) $sub = 'Commercial';
            } elseif ($category === 'Home Garden') {
                if (preg_match('/\b(sofa|chair|table|furniture)\b/i', $tLower)) $sub = 'Furniture';
                elseif (preg_match('/\b(kitchen|cooker|oven)\b/i', $tLower)) $sub = 'Kitchen';
                elseif (preg_match('/\b(garden|mower|tool)\b/i', $tLower)) $sub = 'Garden Tools';
                elseif (preg_match('/\b(decor|vase|painting|frame)\b/i', $tLower)) $sub = 'Decor';
                elseif (preg_match('/\b(appliance|microwave|fridge)\b/i', $tLower)) $sub = 'Appliances';
            } elseif ($category === 'Job') {
                if (preg_match('/\b(driver)\b/i', $tLower)) $sub = 'Driver';
                elseif (preg_match('/\b(software|developer|it)\b/i', $tLower)) $sub = 'IT/Software';
                elseif (preg_match('/\b(sales|marketing)\b/i', $tLower)) $sub = 'Sales/Marketing';
                elseif (preg_match('/\b(teacher|education)\b/i', $tLower)) $sub = 'Education';
            }
        }
        $s['sub_category'] = $sub;

        $cond = trim((string)($s['condition'] ?? ''));
        if ($cond === '') {
            if (preg_match('/\b(brand\s*new|unused|sealed)\b/i', $tLower)) $cond = 'Brand New';
            elseif (preg_match('/\b(used|second\s*hand)\b/i', $tLower)) $cond = 'Used';
        }
        $s['condition'] = $cond;

        if (!isset($s['mileage_km']) || $s['mileage_km'] === '' || $s['mileage_km'] === null) {
            if (preg_match('/\b([0-9][0-9,\.]{1,})\s*(km|kilometers|kilo\s*meters)\b/i', $t, $m)) {
                $s['mileage_km'] = (int) round((float) str_replace([','], [''], $m[1]));
            }
        }

        $loc = trim((string)($s['location'] ?? ''));
        if ($loc === '') {
            $cities = [
                'Colombo','Kandy','Galle','Matara','Gampaha','Negombo','Kalutara','Kurunegala','Anuradhapura','Polonnaruwa',
                'Jaffna','Trincomalee','Batticaloa','Badulla','Nuwara Eliya','Ratnapura','Kegalle','Matale','Puttalam',
                'Hambantota','Monaragala','Ampara','Mannar','Kilinochchi','Mullaitivu','Vavuniya'
            ];
            $found = '';
            if (preg_match('/\b(?:in|at|near)\s+([A-Za-z][A-Za-z\s]+)\b/i', $t, $m)) {
                $candidate = trim($m[1]);
                foreach ($cities as $c) {
                    if (stripos($candidate, $c) !== false) { $found = $c; break; }
                }
            }
            if ($found === '') {
                $tLowerPad = ' ' . strtolower($t) . ' ';
                foreach ($cities as $c) {
                    $needle = ' ' . strtolower($c) . ' ';
                    if (strpos($tLowerPad, $needle) !== false) { $found = $c; break; }
                }
            }
            if ($found !== '') $loc = $found;
        }
        $s['location'] = $loc;

        $s['model_name'] = trim((string)($s['model_name'] ?? ''));
        $s['sub_category'] = trim((string)($s['sub_category'] ?? ''));

        return $s;
    }

    public static function generateSeo(string $category, string $title, string $description, array $structured = [], ?string $prompt = null): array
    {
        $key = getenv('GEMINI_API_KEY') ?: '';
        $defaultRole = "Generate SEO metadata for a marketplace listing.\n"
            . "Return a compact JSON object with keys: seo_title, meta_description, seo_keywords.\n"
            . "Constraints:\n"
            . "- seo_title: <= 60 chars, no emojis, capitalize brand/model when relevant.\n"
            . "- meta_description: <= 160 chars, persuasive, include category and location if present; no emojis.\n"
            . "- seo_keywords: 5–12 comma-separated short keywords (no phrases >3 words), no duplicates.\n"
            . "Only use facts present in the input. Do not invent price or specs.";
        $role = $prompt && trim($prompt) ? $prompt : $defaultRole;

        $input = [
            'category' => $category,
            'title' => $title,
            'description' => $description,
            'structured' => $structured
        ];
        $out = null;
        if ($key) {
            $out = self::callGemini($key, $role, json_encode($input, JSON_UNESCAPED_UNICODE));
        }
        $obj = null;
        if ($out) {
            $decoded = json_decode($out, true);
            if (is_array($decoded)) $obj = $decoded;
        }

        if (!is_array($obj)) {
            $obj = [];
            $loc = trim((string)($structured['location'] ?? ''));
            $sub = trim((string)($structured['sub_category'] ?? ''));
            $model = trim((string)($structured['model_name'] ?? ''));
            $cat = trim((string)$category);
            $baseTitle = trim($title);
            $seoTitle = $baseTitle;
            if ($model && stripos($baseTitle, $model) === false) {
                $seoTitle = $model . ' - ' . $baseTitle;
            }
            if ($loc && stripos($seoTitle, $loc) === false) {
                $seoTitle = $seoTitle . ' in ' . $loc;
            }
            $obj['seo_title'] = mb_substr($seoTitle, 0, 60);
            $desc = $description ?: '';
            $snippet = trim($desc);
            if ($snippet === '') {
                $snippet = ($cat ? ($cat . ' listing') : 'Listing') . ($loc ? (' in ' . $loc) : '');
                if ($model) $snippet = $model . ' — ' . $snippet;
                $snippet .= '.';
            }
            $obj['meta_description'] = mb_substr($snippet, 0, 160);
            $tokens = [];
            foreach (explode(' ', strtolower($baseTitle . ' ' . $cat . ' ' . $sub . ' ' . $model)) as $tok) {
                $tok = preg_replace('/[^a-z0-9]/', '', $tok);
                if ($tok && strlen($tok) >= 2) $tokens[$tok] = true;
            }
            $kw = array_slice(array_keys($tokens), 0, 12);
            $obj['seo_keywords'] = implode(', ', $kw);
        }

        $seoTitle = trim((string)($obj['seo_title'] ?? ''));
        $metaDesc = trim((string)($obj['meta_description'] ?? ''));
        $keywords = trim((string)($obj['seo_keywords'] ?? ''));

        $seoTitle = $seoTitle !== '' ? mb_substr($seoTitle, 0, 60) : mb_substr($title, 0, 60);
        $metaDesc = $metaDesc !== '' ? mb_substr($metaDesc, 0, 160) : mb_substr($description, 0, 160);

        return [
            'seo_title' => $seoTitle,
            'meta_description' => $metaDesc,
            'seo_keywords' => $keywords,
            'seo_json' => json_encode(['seo_title' => $seoTitle, 'meta_description' => $metaDesc, 'seo_keywords' => $keywords])
        ];
    }

    public static function extractVehicleSpecs(string $title, string $description, string $subCategory = ''): array
    {
        $key = getenv('GEMINI_API_KEY') ?: '';
        $role = "Extract normalized vehicle specifications from a marketplace listing.\n"
            . "Return JSON with keys:\n"
            . "- engine_capacity_cc: integer or null\n"
            . "- transmission: one of Manual, Automatic (or null)\n"
            . "- fuel_type: one of Petrol, Diesel, Hybrid, Electric (or null)\n"
            . "- doors: integer or null\n"
            . "- fuel_economy_km_per_l: number or null\n"
            . "- mileage_km: integer or null\n"
            . "- sub_category: Car, Bike, Van, Bus, SUV, Scooter, etc., or null\n"
            . "- model_name: string or null\n"
            . "Only use facts present in the input.";
        $input = json_encode(['title' => $title, 'description' => $description, 'sub_category' => $subCategory], JSON_UNESCAPED_UNICODE);
        $out = $key ? (self::callGemini($key, $role, $input) ?? '{}') : '{}';
        $obj = json_decode($out, true);
        if (!is_array($obj)) $obj = [];

        $t = strtolower($title . " \n" . $description);

        // Heuristic fallbacks if model fails/misses fields
        $engine = isset($obj['engine_capacity_cc']) ? (int)$obj['engine_capacity_cc'] : null;
        if (!$engine) {
            if (preg_match('/\b([0-9]{3,4})\s*cc\b/i', $t, $m)) $engine = (int)$m[1];
            elseif (preg_match('/\b([1-9](?:\.[0-9])?)\s*l\b/i', $t, $m)) $engine = (int)round(((float)$m[1]) * 1000);
        }

        $trans = trim((string)($obj['transmission'] ?? ''));
        if ($trans === '') {
            $trans = (preg_match('/\b(auto|automatic)\b/i', $t)) ? 'Automatic' : ((preg_match('/\b(manual|stick)\b/i', $t)) ? 'Manual' : null);
        } else {
            $transLower = strtolower($trans);
            if (str_contains($transLower, 'auto')) $trans = 'Automatic';
            elseif (str_contains($transLower, 'manual')) $trans = 'Manual';
            else $trans = null;
        }

        $fuel = trim((string)($obj['fuel_type'] ?? ''));
        if ($fuel === '') {
            if (preg_match('/\b(hybrid)\b/i', $t)) $fuel = 'Hybrid';
            elseif (preg_match('/\b(electric|ev)\b/i', $t)) $fuel = 'Electric';
            elseif (preg_match('/\b(diesel)\b/i', $t)) $fuel = 'Diesel';
            elseif (preg_match('/\b(petrol|gasoline)\b/i', $t)) $fuel = 'Petrol';
            else $fuel = null;
        } else {
            $fl = strtolower($fuel);
            if (str_contains($fl, 'hybrid')) $fuel = 'Hybrid';
            elseif (str_contains($fl, 'electric') || $fl === 'ev') $fuel = 'Electric';
            elseif (str_contains($fl, 'diesel')) $fuel = 'Diesel';
            elseif (str_contains($fl, 'petrol') || str_contains($fl, 'gasoline')) $fuel = 'Petrol';
            else $fuel = null;
        }

        $doors = isset($obj['doors']) ? (int)$obj['doors'] : null;
        if (!$doors) {
            if (preg_match('/\b([24])\s*door(s)?\b/i', $t, $m)) $doors = (int)$m[1];
        }

        $economy = $obj['fuel_economy_km_per_l'] ?? null;
        if ($economy === null || $economy === '') {
            if (preg_match('/\b([0-9]{2,3})\s*km\/l\b/i', $t, $m)) $economy = (float)$m[1];
        } else {
            $economy = (float)$economy;
        }

        $mileage = $obj['mileage_km'] ?? null;
        if ($mileage === null || $mileage === '') {
            if (preg_match('/\b([0-9][0-9,\.]{3,})\s*km\b/i', $t, $m)) $mileage = (int)round((float)str_replace(',', '', $m[1]));
        } else {
            $mileage = (int)$mileage;
        }

        $sub = trim((string)($obj['sub_category'] ?? ''));
        if ($sub === '') {
            if (preg_match('/\b(bike|motorcycle|scooter)\b/i', $t)) $sub = 'Bike';
            elseif (preg_match('/\b(car|sedan|hatchback|suv)\b/i', $t)) $sub = 'Car';
            elseif (preg_match('/\b(van)\b/i', $t)) $sub = 'Van';
            elseif (preg_match('/\b(bus)\b/i', $t)) $sub = 'Bus';
        }

        $model = trim((string)($obj['model_name'] ?? ''));
        if ($model === '') {
            if (preg_match('/\b(toyota|honda|nissan|suzuki|hyundai|kia|mazda|bmw|mercedes|audi|lexus)\s+([A-Za-z0-9\- ]{2,})/i', $t, $m)) {
                $model = substr(trim($m[1] . ' ' . $m[2]), 0, 50);
            }
        }

        return [
            'engine_capacity_cc' => $engine ?: null,
            'transmission' => $trans ?: null,
            'fuel_type' => $fuel ?: null,
            'doors' => $doors ?: null,
            'fuel_economy_km_per_l' => is_numeric($economy) ? (float)$economy : null,
            'mileage_km' => is_numeric($mileage) ? (int)$mileage : null,
            'sub_category' => $sub ?: null,
            'model_name' => $model ?: null
        ];
    }
}
}