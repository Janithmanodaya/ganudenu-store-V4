<?php
namespace App\Services;

class SSE
{
    public static function start(): void
    {
        ignore_user_abort(true);

        // Make sure any previous Content-Type isn't lingering
        if (function_exists('header_remove')) {
            @header_remove('Content-Type');
        }
        // Disable gzip if any
        @ini_set('zlib.output_compression', '0');

        header('Content-Type: text/event-stream');
        header('Cache-Control: no-cache, no-transform');
        header('Connection: keep-alive');
        // Hint some proxies/servers to not buffer SSE
        header('X-Accel-Buffering: no');

        // End existing buffers
        while (ob_get_level() > 0) {
            @ob_end_flush();
        }
        @ob_implicit_flush(true);
        echo ": open\n\n";
        flush();
    }

    public static function event(string $name, array $data): void
    {
        echo "event: {$name}\n";
        echo "data: " . json_encode($data) . "\n\n";
        flush();
    }

    public static function heartbeat(): void
    {
        echo ": ping\n\n";
        flush();
    }
}