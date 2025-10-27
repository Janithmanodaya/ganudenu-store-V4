<?php
use PHPUnit\Framework\TestCase;
use App\Services\JWT;

require __DIR__ . '/../../app/bootstrap.php';

final class JwtTest extends TestCase
{
    public function testSignAndVerify(): void
    {
        $token = JWT::sign(['user_id' => 1, 'email' => 'test@example.com', 'is_admin' => false], '1h');
        $this->assertIsString($token);
        $v = JWT::verify($token);
        $this->assertTrue($v['ok']);
        $this->assertSame(1, (int)$v['decoded']['user_id']);
        $this->assertSame('test@example.com', strtolower($v['decoded']['email']));
    }
}