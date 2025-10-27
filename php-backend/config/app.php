<?php
return [
    'env' => getenv('APP_ENV') ?: 'development',
    'debug' => strtolower(getenv('APP_DEBUG') ?: '') === 'true',
    'url' => getenv('APP_URL') ?: 'http://localhost:8080',
    'domain' => getenv('PUBLIC_DOMAIN') ?: 'https://ganudenu.store'
];