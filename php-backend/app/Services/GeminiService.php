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
        // Fallback: simple formatted text with emojis
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

        // Fallback heuristic
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

        // Start with model output (if any)
        $s = $obj;

        // Heuristics to enrich/auto-fill when model not available or fields are empty
        $t = $title . " \n" . $description;
        $tLower = strtolower($t);

        // Phone: accept +94XXXXXXXXX or 0XXXXXXXXX and normalize to +94
        $phone = trim((string)($s['phone'] ?? ''));
        if (!$phone) {
            if (preg_match('/\\+94\\d{9}/', $t, $m)) {
                $phone = $m[0];
            } elseif (preg_match('/\\b0\\d{9}\\b/', $t, $m)) {
                // Convert 0XXXXXXXXX to +94XXXXXXXXX
                $phone = '+94' . substr($m[0], 1);
            }
        }
        $s['phone'] = $phone;

        // Price: detect numbers, support 'k' and 'lakh', but avoid confusing model/year as price.
        // We only trust price if accompanied by currency markers or units, or explicit "price"/"rs"/"lkr" cues.
        $price = $s['price'] ?? null;
        $hasCurrencyCue = (bool)preg_match('/\\b(rs|රු|lkr|price)\\b/i', $t);
        if ($price === null || $price === '' || (is_string($price) && trim($price) === '')) {
            if (preg_match('/\\b(?:rs|රු|lkr|price)[:\\s]*([0-9][0-9,\\.]*)(\\s*(k|lakh|lak))?/i', $t, $m)) {
                $numStr = str_replace(',', '', $m[1]);
                $base = (float)$numStr;
                $mul = 1.0;
                $unit = strtolower($m[3] ?? '');
                if ($unit === 'k') $mul = 1000.0;
                elseif ($unit === 'lakh' || $unit === 'lak') $mul = 100000.0;
                $price = $base * $mul;
            } elseif (preg_match('/\\b([0-9]+(?:\\.[0-9]+)?)\\s*(k|lakh|lak)\\b/i', $t, $m)) {
                $base = (float)$m[1];
                $mul = strtolower($m[2]) === 'k' ? 1000.0 : 100000.0;
                $price = $base * $mul;
            } elseif ($hasCurrencyCue && preg_match('/\\b([0-9][0-9,]{3,})\\b/', $t, $m)) {
                // Numbers with thousands separators are likely prices when currency cue exists
                $price = (float) str_replace(',', '', $m[1]);
            } else {
                // Be conservative to avoid taking a model number as price
                $price = null;
            }
        }
        if (is_string($price)) {
            $raw = strtolower(trim($price));
            if (preg_match('/^([0-9]+(?:\\.[0-9]+)?)\\s*k$/', $raw, $m)) $price = (float)$m[1] * 1000;
            elseif (preg_replace('/[^0-9.]/', '', $raw) !== '') $price = (float) preg_replace('/[^0-9.]/', '', $raw);
            else $price = null;
        }
        // If price looks like a year (1950-2100) or small (<= 3000) without currency cues, drop it (likely model/year)
        if (is_numeric($price)) {
            $p = (float)$price;
            if (($p >= 1950 && $p <= 2100) || (!$hasCurrencyCue && $p <= 3000)) {
                $price = null;
            }
        }
        $s['price'] = is_numeric($price) ? (float)$price : null;

        // Pricing type default
        $pt = strtolower(trim((string)($s['pricing_type'] ?? '')));
        if ($pt) {
            if (str_contains($pt, 'nego')) $pt = 'Negotiable';
            elseif (str_contains($pt, 'fixed')) $pt = 'Fixed Price';
        } else {
            $pt = 'Negotiable';
        }
        $s['pricing_type'] = $pt;

        // Manufacture year
        $yr = $s['manufacture_year'] ?? ($s['year'] ?? null);
        if (!$yr) {
            if (preg_match('/\\b(19[5-9][0-9]|20[0-9]{2}|2100)\\b/', $t, $m)) {
                $yr = (int)$m[1];
            }
        } elseif (is_string($yr)) {
            $num = (int) preg_replace('/[^0-9]/', '', $yr);
            $yr = ($num >= 1950 && $num <= 2100) ? $num : null;
        } elseif (!is_int($yr)) {
            $yr = null;
        }
        $s['manufacture_year'] = $yr;

        // Guard: if model mistakenly set into price (e.g., price == year), drop price
        if (isset($s['price']) && is_numeric($s['price']) && $yr && abs((float)$s['price'] - (int)$yr) <= 1) {
            $s['price'] = null;
        }

        // Model name: try to infer for vehicles/mobiles/electronics
        $model = trim((string)($s['model_name'] ?? ($s['model'] ?? '')));
        if ($model === '') {
            // Simple extraction: brand + model pattern
            $brands = ['toyota','honda','nissan','suzuki','hyundai','kia','mazda','mitsubishi','bmw','mercedes','audi','lexus','apple','samsung','xiaomi','oppo','vivo','realme','nokia','oneplus','google','dell','hp','lenovo','asus','acer','canon','nikon','sony','panasonic'];
            foreach ($brands as $b) {
                if (preg_match('/\\b(' . preg_quote($b, '/') . ')\\s+([A-Za-z0-9\\- ]{2,})/i', $t, $m)) {
                    $cand = trim($m[1] . ' ' . $m[2]);
                    // Limit model length
                    $model = substr($cand, 0, 50);
                    break;
                }
            }
        }
        $s['model_name'] = $model;

        // Sub-category: infer for known categories
        $sub = trim((string)($s['sub_category'] ?? ''));
        if ($sub === '') {
            if ($category === 'Vehicle') {
                if (preg_match('/\\b(bike|motorcycle|scooter)\\b/i', $tLower)) $sub = 'Bike';
                elseif (preg_match('/\\b(car|sedan|hatchback|suv)\\b/i', $tLower)) $sub = 'Car';
                elseif (preg_match('/\\b(van)\\b/i', $tLower)) $sub = 'Van';
                elseif (preg_match('/\\b(bus)\\b/i', $tLower)) $sub = 'Bus';
            } elseif ($category === 'Mobile') {
                if (preg_match('/\\b(phone|smartphone|iphone|android)\\b/i', $tLower)) $sub = 'Smartphone';
                elseif (preg_match('/\\b(tablet|ipad)\\b/i', $tLower)) $sub = 'Tablet';
                elseif (preg_match('/\\b(watch)\\b/i', $tLower)) $sub = 'Smartwatch';
            } elseif ($category === 'Electronic') {
                if (preg_match('/\\b(laptop|notebook|macbook)\\b/i', $tLower)) $sub = 'Laptop';
                elseif (preg_match('/\\b(desktop|pc)\\b/i', $tLower)) $sub = 'Desktop';
                elseif (preg_match('/\\b(tv|television)\\b/i', $tLower)) $sub = 'TV';
                elseif (preg_match('/\\b(camera|dslr)\\b/i', $tLower)) $sub = 'Camera';
                elseif (preg_match('/\\b(audio|speaker|headphone|earbud)\\b/i', $tLower)) $sub = 'Audio';
                elseif (preg_match('/\\b(fridge|refrigerator|washing machine|microwave)\\b/i', $tLower)) $sub = 'Appliances';
            } elseif ($category === 'Property') {
                if (preg_match('/\\b(house|home)\\b/i', $tLower)) $sub = 'House';
                elseif (preg_match('/\\b(apartment|flat)\\b/i', $tLower)) $sub = 'Apartment';
                elseif (preg_match('/\\b(land|plot|acre|perch)\\b/i', $tLower)) $sub = 'Land';
                elseif (preg_match('/\\b(room|annex)\\b/i', $tLower)) $sub = 'Room/Annex';
                elseif (preg_match('/\\b(shop|office|commercial)\\b/i', $tLower)) $sub = 'Commercial';
            } elseif ($category === 'Home Garden') {
                if (preg_match('/\\b(sofa|chair|table|furniture)\\b/i', $tLower)) $sub = 'Furniture';
                elseif (preg_match('/\\b(kitchen|cooker|oven)\\b/i', $tLower)) $sub = 'Kitchen';
                elseif (preg_match('/\\b(garden|mower|tool)\\b/i', $tLower)) $sub = 'Garden Tools';
                elseif (preg_match('/\\b(decor|vase|painting|frame)\\b/i', $tLower)) $sub = 'Decor';
                elseif (preg_match('/\\b(appliance|microwave|fridge)\\b/i', $tLower)) $sub = 'Appliances';
            } elseif ($category === 'Job') {
                if (preg_match('/\\b(driver)\\b/i', $tLower)) $sub = 'Driver';
                elseif (preg_match('/\\b(software|developer|it)\\b/i', $tLower)) $sub = 'IT/Software';
                elseif (preg_match('/\\b(sales|marketing)\\b/i', $tLower)) $sub = 'Sales/Marketing';
                elseif (preg_match('/\\b(teacher|education)\\b/i', $tLower)) $sub = 'Education';
            }
        }
        $s['sub_category'] = $sub;

        // Condition heuristic (Brand New / Used)
        $cond = trim((string)($s['condition'] ?? ''));
        if ($cond === '') {
            if (preg_match('/\\b(brand\\s*new|unused|sealed)\\b/i', $tLower)) $cond = 'Brand New';
            elseif (preg_match('/\\b(used|second\\s*hand)\\b/i', $tLower)) $cond = 'Used';
        }
        $s['condition'] = $cond;

        // Mileage (km)
        if (!isset($s['mileage_km']) || $s['mileage_km'] === '' || $s['mileage_km'] === null) {
            if (preg_match('/\\b([0-9][0-9,\\.]{1,})\\s*(km|kilometers|kilo\\s*meters)\\b/i', $t, $m)) {
                $s['mileage_km'] = (int) round((float) str_replace([','], [''], $m[1]));
            }
        }

        // Location: if missing, try to infer from a list of common Sri Lankan cities/districts and patterns like "in Kandy"
        $loc = trim((string)($s['location'] ?? ''));
        if ($loc === '') {
            $cities = [
                'Colombo','Kandy','Galle','Matara','Gampaha','Negombo','Kalutara','Kurunegala','Anuradhapura','Polonnaruwa',
                'Jaffna','Trincomalee','Batticaloa','Badulla','Nuwara Eliya','Ratnapura','Kegalle','Matale','Puttalam',
                'Hambantota','Monaragala','Ampara','Mannar','Kilinochchi','Mullaitivu','Vavuniya'
            ];
            $found = '';
            // Pattern: "in {city}" or "{city} area"
            if (preg_match('/\\b(?:in|at|near)\\s+([A-Za-z][A-Za-z\\s]+)\\b/i', $t, $m)) {
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

        // Normalize simple fields
        $s['model_name'] = trim((string)($s['model_name'] ?? ''));
        $s['sub_category'] = trim((string)($s['sub_category'] ?? ''));

        return $s;
    }
}