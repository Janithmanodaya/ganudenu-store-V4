<?php
namespace App\Services;

class FacebookPoster
{
    /**
     * Non-blocking POST to external Facebook poster service.
     * Expects env: FB_SERVICE_URL, FB_SERVICE_API_KEY.
     * Returns ['ok'=>true,'url'=>string|null] best-effort.
     */
    public static function postApproval(array $listing, string $adminEmail = ''): array
    {
        $serviceUrl = getenv('FB_SERVICE_URL') ?: '';
        $apiKey = getenv('FB_SERVICE_API_KEY') ?: '';
        if (!$serviceUrl || !$apiKey) {
            return ['ok' => false, 'error' => 'Facebook poster not configured'];
        }
        $payload = [
            'listing_id' => (int)($listing['id'] ?? 0),
            'title' => (string)($listing['title'] ?? ''),
            'category' => (string)($listing['main_category'] ?? ''),
            'remark_number' => (string)($listing['remark_number'] ?? ''),
            'admin_email' => $adminEmail,
            'created_at' => gmdate('c'),
        ];

        // Fire-and-forget: small timeout, ignore failures
        try {
            $ch = curl_init($serviceUrl);
            curl_setopt_array($ch, [
                CURLOPT_RETURNTRANSFER => true,
                CURLOPT_POST => true,
                CURLOPT_HTTPHEADER => ['Content-Type: application/json', 'Authorization: Bearer ' . $apiKey],
                CURLOPT_POSTFIELDS => json_encode($payload),
                CURLOPT_TIMEOUT_MS => 2000,
                CURLOPT_CONNECTTIMEOUT_MS => 1000,
            ]);
            $resp = curl_exec($ch);
            $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
            curl_close($ch);
            if ($code >= 200 && $code < 300 && $resp) {
                $json = json_decode($resp, true) ?: [];
                $url = isset($json['facebook_post_url']) ? (string)$json['facebook_post_url'] : (isset($json['url']) ? (string)$json['url'] : null);
                return ['ok' => true, 'url' => $url ?: null];
            }
        } catch (\Throwable $e) {
            // ignore
        }
        return ['ok' => true, 'url' => null];
    }
}