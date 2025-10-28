<?php
namespace App\Services;

use App\Router;
use ReflectionMethod;

class AutoRoutes
{
    // Canonical route map based on current project conventions.
    // This returns a superset; registration will check class/method existence.
    public static function generateCanonical(): array
    {
        $C = [
            'Static' => '\\App\\Controllers\\StaticController',
            'Auth' => '\\App\\Controllers\\AuthController',
            'Listings' => '\\App\\Controllers\\ListingsController',
            'Admin' => '\\App\\Controllers\\AdminController',
            'Users' => '\\App\\Controllers\\UsersController',
            'Wanted' => '\\App\\Controllers\\WantedController',
            'Notifications' => '\\App\\Controllers\\NotificationsController',
            'Chats' => '\\App\\Controllers\\ChatsController',
            'Jobs' => '\\App\\Controllers\\JobsController',
            'NotifDigest' => '\\App\\Controllers\\NotificationDigestController',
        ];

        $R = [];

        // Public static
        $R[] = ['method' => 'GET', 'pattern' => '/robots.txt', 'controller' => $C['Static'], 'action' => 'robots', 'opts' => []];
        $R[] = ['method' => 'GET', 'pattern' => '/sitemap.xml', 'controller' => $C['Static'], 'action' => 'sitemap', 'opts' => []];

        // Health
        $R[] = ['method' => 'GET', 'pattern' => '/api/health', 'closure' => function () {
            \json_response(['ok' => true, 'service' => 'ganudenu.store', 'ts' => gmdate('c')]);
        }, 'opts' => ['rate_group' => 'GLOBAL']];

        // Static + SSE
        $R[] = ['method' => 'GET', 'pattern' => '/api/banners', 'controller' => $C['Static'], 'action' => 'banners', 'opts' => ['rate_group' => 'GLOBAL']];
        $R[] = ['method' => 'GET', 'pattern' => '/api/maintenance-status', 'controller' => $C['Static'], 'action' => 'maintenanceStatus', 'opts' => ['rate_group' => 'GLOBAL']];
        $R[] = ['method' => 'GET', 'pattern' => '/api/maintenance-status/stream', 'controller' => $C['Static'], 'action' => 'maintenanceStream', 'opts' => []];

        // Auth
        $R[] = ['method' => 'GET', 'pattern' => '/api/auth/google/start', 'controller' => $C['Auth'], 'action' => 'googleStart', 'opts' => ['rate_group' => 'AUTH']];
        $R[] = ['method' => 'GET', 'pattern' => '/api/auth/google/callback', 'controller' => $C['Auth'], 'action' => 'googleCallback', 'opts' => ['rate_group' => 'AUTH']];
        $R[] = ['method' => 'GET', 'pattern' => '/api/auth/google/debug', 'controller' => $C['Auth'], 'action' => 'googleDebug', 'opts' => ['rate_group' => 'AUTH']];
        $R[] = ['method' => 'GET', 'pattern' => '/api/auth/user-exists', 'controller' => $C['Auth'], 'action' => 'userExists', 'opts' => ['rate_group' => 'AUTH']];
        $R[] = ['method' => 'POST', 'pattern' => '/api/auth/update-username', 'controller' => $C['Auth'], 'action' => 'updateUsername', 'opts' => ['rate_group' => 'AUTH']];
        $R[] = ['method' => 'POST', 'pattern' => '/api/auth/upload-profile-photo', 'controller' => $C['Auth'], 'action' => 'uploadProfilePhoto', 'opts' => ['rate_group' => 'AUTH']];
        $R[] = ['method' => 'POST', 'pattern' => '/api/auth/delete-account', 'controller' => $C['Auth'], 'action' => 'deleteAccount', 'opts' => ['rate_group' => 'AUTH']];
        $R[] = ['method' => 'POST', 'pattern' => '/api/auth/send-registration-otp', 'controller' => $C['Auth'], 'action' => 'sendRegistrationOtp', 'opts' => ['rate_group' => 'AUTH']];
        $R[] = ['method' => 'POST', 'pattern' => '/api/auth/verify-otp-and-register', 'controller' => $C['Auth'], 'action' => 'verifyOtpAndRegister', 'opts' => ['rate_group' => 'AUTH']];
        $R[] = ['method' => 'POST', 'pattern' => '/api/auth/login', 'controller' => $C['Auth'], 'action' => 'login', 'opts' => ['rate_group' => 'AUTH']];
        $R[] = ['method' => 'POST', 'pattern' => '/api/auth/verify-admin-login-otp', 'controller' => $C['Auth'], 'action' => 'verifyAdminLoginOtp', 'opts' => ['rate_group' => 'AUTH']];
        $R[] = ['method' => 'POST', 'pattern' => '/api/auth/verify-login-otp', 'controller' => $C['Auth'], 'action' => 'verifyLoginOtp', 'opts' => ['rate_group' => 'AUTH']];
        $R[] = ['method' => 'POST', 'pattern' => '/api/auth/forgot-password', 'controller' => $C['Auth'], 'action' => 'forgotPassword', 'opts' => ['rate_group' => 'AUTH']];
        $R[] = ['method' => 'POST', 'pattern' => '/api/auth/verify-password-otp', 'controller' => $C['Auth'], 'action' => 'verifyPasswordOtp', 'opts' => ['rate_group' => 'AUTH']];
        $R[] = ['method' => 'POST', 'pattern' => '/api/auth/reset-password', 'controller' => $C['Auth'], 'action' => 'resetPassword', 'opts' => ['rate_group' => 'AUTH']];
        $R[] = ['method' => 'GET', 'pattern' => '/api/auth/status', 'controller' => $C['Auth'], 'action' => 'status', 'opts' => ['rate_group' => 'GLOBAL']];

        // Jobs
        $R[] = ['method' => 'POST', 'pattern' => '/api/jobs/employee/draft', 'controller' => $C['Jobs'], 'action' => 'employeeDraft', 'opts' => ['rate_group' => 'LISTINGS']];

        // Notifications
        $R[] = ['method' => 'GET', 'pattern' => '/api/notifications/', 'controller' => $C['Notifications'], 'action' => 'list', 'opts' => ['rate_group' => 'GLOBAL']];
        $R[] = ['method' => 'GET', 'pattern' => '/api/notifications/unread-count', 'controller' => $C['Notifications'], 'action' => 'unreadCount', 'opts' => ['rate_group' => 'GLOBAL']];
        $R[] = ['method' => 'POST', 'pattern' => '/api/notifications/:id/read', 'controller' => $C['Notifications'], 'action' => 'markRead', 'opts' => ['rate_group' => 'GLOBAL']];
        $R[] = ['method' => 'POST', 'pattern' => '/api/notifications/saved-searches', 'controller' => $C['Notifications'], 'action' => 'savedSearchCreate', 'opts' => ['rate_group' => 'GLOBAL']];
        $R[] = ['method' => 'GET', 'pattern' => '/api/notifications/saved-searches', 'controller' => $C['Notifications'], 'action' => 'savedSearchList', 'opts' => ['rate_group' => 'GLOBAL']];
        $R[] = ['method' => 'DELETE', 'pattern' => '/api/notifications/saved-searches/:id', 'controller' => $C['Notifications'], 'action' => 'savedSearchDelete', 'opts' => ['rate_group' => 'GLOBAL']];
        $R[] = ['method' => 'POST', 'pattern' => '/api/notifications/saved-searches/notify-for-listing', 'controller' => $C['Notifications'], 'action' => 'savedSearchNotifyForListing', 'opts' => ['rate_group' => 'GLOBAL']];
        $R[] = ['method' => 'GET', 'pattern' => '/api/notifications/unread-count/stream', 'controller' => $C['Notifications'], 'action' => 'unreadStream', 'opts' => []];

        // Users
        $R[] = ['method' => 'GET', 'pattern' => '/api/users/profile', 'controller' => $C['Users'], 'action' => 'profileGet', 'opts' => ['rate_group' => 'GLOBAL']];
        $R[] = ['method' => 'POST', 'pattern' => '/api/users/profile', 'controller' => $C['Users'], 'action' => 'profilePost', 'opts' => ['rate_group' => 'GLOBAL']];
        $R[] = ['method' => 'POST', 'pattern' => '/api/users/rate', 'controller' => $C['Users'], 'action' => 'rate', 'opts' => ['rate_group' => 'GLOBAL']];

        // Listings
        $R[] = ['method' => 'POST', 'pattern' => '/api/listings/draft', 'controller' => $C['Listings'], 'action' => 'draft', 'opts' => ['rate_group' => 'LISTINGS']];
        $R[] = ['method' => 'GET', 'pattern' => '/api/listings/draft/:id', 'controller' => $C['Listings'], 'action' => 'draftGet', 'opts' => ['rate_group' => 'LISTINGS']];
        $R[] = ['method' => 'DELETE', 'pattern' => '/api/listings/draft/:id', 'controller' => $C['Listings'], 'action' => 'draftDelete', 'opts' => ['rate_group' => 'LISTINGS']];
        $R[] = ['method' => 'POST', 'pattern' => '/api/listings/submit', 'controller' => $C['Listings'], 'action' => 'submit', 'opts' => ['rate_group' => 'LISTINGS']];
        $R[] = ['method' => 'POST', 'pattern' => '/api/listings/describe', 'controller' => $C['Listings'], 'action' => 'describe', 'opts' => ['rate_group' => 'LISTINGS']];
        $R[] = ['method' => 'POST', 'pattern' => '/api/listings/vehicle-specs', 'controller' => $C['Listings'], 'action' => 'vehicleSpecs', 'opts' => ['rate_group' => 'LISTINGS']];
        $R[] = ['method' => 'POST', 'pattern' => '/api/listings/draft/:id/images', 'controller' => $C['Listings'], 'action' => 'draftImageAdd', 'opts' => ['rate_group' => 'LISTINGS']];
        $R[] = ['method' => 'DELETE', 'pattern' => '/api/listings/draft/:id/images/:imageId', 'controller' => $C['Listings'], 'action' => 'draftImageDelete', 'opts' => ['rate_group' => 'LISTINGS']];
        $R[] = ['method' => 'GET', 'pattern' => '/api/listings/', 'controller' => $C['Listings'], 'action' => 'list', 'opts' => ['rate_group' => 'LISTINGS']];
        $R[] = ['method' => 'GET', 'pattern' => '/api/listings/search', 'controller' => $C['Listings'], 'action' => 'search', 'opts' => ['rate_group' => 'LISTINGS']];
        $R[] = ['method' => 'GET', 'pattern' => '/api/listings/filters', 'controller' => $C['Listings'], 'action' => 'filters', 'opts' => ['rate_group' => 'LISTINGS']];
        $R[] = ['method' => 'GET', 'pattern' => '/api/listings/suggestions', 'controller' => $C['Listings'], 'action' => 'suggestions', 'opts' => ['rate_group' => 'LISTINGS']];
        $R[] = ['method' => 'GET', 'pattern' => '/api/listings/similar', 'controller' => $C['Listings'], 'action' => 'similar', 'opts' => ['rate_group' => 'LISTINGS']]; // method exists? In ListingsController it calls similar([]) but there is no method 'similar' defined; keep guarded by existence check.
        $R[] = ['method' => 'GET', 'pattern' => '/api/listings/my', 'controller' => $C['Listings'], 'action' => 'my', 'opts' => ['rate_group' => 'LISTINGS']];
        $R[] = ['method' => 'GET', 'pattern' => '/api/listings/my-drafts', 'controller' => $C['Listings'], 'action' => 'myDrafts', 'opts' => ['rate_group' => 'LISTINGS']];
        $R[] = ['method' => 'GET', 'pattern' => '/api/listings/:id', 'controller' => $C['Listings'], 'action' => 'get', 'opts' => ['rate_group' => 'LISTINGS']];
        $R[] = ['method' => 'DELETE', 'pattern' => '/api/listings/:id', 'controller' => $C['Listings'], 'action' => 'delete', 'opts' => ['rate_group' => 'LISTINGS']];
        $R[] = ['method' => 'POST', 'pattern' => '/api/listings/:id/report', 'controller' => $C['Listings'], 'action' => 'report', 'opts' => ['rate_group' => 'LISTINGS']];
        $R[] = ['method' => 'GET', 'pattern' => '/api/listings/payment-info/:id', 'controller' => $C['Listings'], 'action' => 'paymentInfo', 'opts' => ['rate_group' => 'LISTINGS']];
        $R[] = ['method' => 'POST', 'pattern' => '/api/listings/payment-note', 'controller' => $C['Listings'], 'action' => 'paymentNote', 'opts' => ['rate_group' => 'LISTINGS']];

        // Admin
        $R[] = ['method' => 'GET', 'pattern' => '/api/admin/env-status', 'controller' => $C['Admin'], 'action' => 'envStatus', 'opts' => ['rate_group' => 'ADMIN']];
        $R[] = ['method' => 'GET', 'pattern' => '/api/admin/diagnostics', 'controller' => $C['Admin'], 'action' => 'diagnostics', 'opts' => ['rate_group' => 'ADMIN']];
        $R[] = ['method' => 'GET', 'pattern' => '/api/admin/config', 'controller' => $C['Admin'], 'action' => 'configGet', 'opts' => ['rate_group' => 'ADMIN']];
        $R[] = ['method' => 'POST', 'pattern' => '/api/admin/config', 'controller' => $C['Admin'], 'action' => 'configPost', 'opts' => ['rate_group' => 'ADMIN']];
        $R[] = ['method' => 'GET', 'pattern' => '/api/admin/config-secure/status', 'controller' => $C['Admin'], 'action' => 'configSecureStatus', 'opts' => ['rate_group' => 'ADMIN']];
        $R[] = ['method' => 'POST', 'pattern' => '/api/admin/config-secure/decrypt', 'controller' => $C['Admin'], 'action' => 'configSecureDecrypt', 'opts' => ['rate_group' => 'ADMIN']];
        $R[] = ['method' => 'POST', 'pattern' => '/api/admin/config-secure/encrypt', 'controller' => $C['Admin'], 'action' => 'configSecureEncrypt', 'opts' => ['rate_group' => 'ADMIN']];
        $R[] = ['method' => 'GET', 'pattern' => '/api/admin/prompts', 'controller' => $C['Admin'], 'action' => 'promptsGet', 'opts' => ['rate_group' => 'ADMIN']];
        $R[] = ['method' => 'POST', 'pattern' => '/api/admin/prompts', 'controller' => $C['Admin'], 'action' => 'promptsPost', 'opts' => ['rate_group' => 'ADMIN']];
        $R[] = ['method' => 'GET', 'pattern' => '/api/admin/pending', 'controller' => $C['Admin'], 'action' => 'pendingList', 'opts' => ['rate_group' => 'ADMIN']];
        $R[] = ['method' => 'GET', 'pattern' => '/api/admin/pending/:id', 'controller' => $C['Admin'], 'action' => 'pendingGet', 'opts' => ['rate_group' => 'ADMIN']];
        $R[] = ['method' => 'POST', 'pattern' => '/api/admin/pending/:id/update', 'controller' => $C['Admin'], 'action' => 'pendingUpdate', 'opts' => ['rate_group' => 'ADMIN']];
        $R[] = ['method' => 'POST', 'pattern' => '/api/admin/pending/:id/approve', 'controller' => $C['Admin'], 'action' => 'pendingApprove', 'opts' => ['rate_group' => 'ADMIN']];
        $R[] = ['method' => 'POST', 'pattern' => '/api/admin/pending/:id/reject', 'controller' => $C['Admin'], 'action' => 'pendingReject', 'opts' => ['rate_group' => 'ADMIN']];
        $R[] = ['method' => 'POST', 'pattern' => '/api/admin/pending/approve_many', 'controller' => $C['Admin'], 'action' => 'pendingApproveMany', 'opts' => ['rate_group' => 'ADMIN']];

        $R[] = ['method' => 'GET', 'pattern' => '/api/admin/banners', 'controller' => $C['Admin'], 'action' => 'bannersList', 'opts' => ['rate_group' => 'ADMIN']];
        $R[] = ['method' => 'POST', 'pattern' => '/api/admin/banners', 'controller' => $C['Admin'], 'action' => 'bannersUpload', 'opts' => ['rate_group' => 'ADMIN']];
        $R[] = ['method' => 'POST', 'pattern' => '/api/admin/banners/:id/active', 'controller' => $C['Admin'], 'action' => 'bannersActive', 'opts' => ['rate_group' => 'ADMIN']];
        $R[] = ['method' => 'DELETE', 'pattern' => '/api/admin/banners/:id', 'controller' => $C['Admin'], 'action' => 'bannersDelete', 'opts' => ['rate_group' => 'ADMIN']];

        $R[] = ['method' => 'GET', 'pattern' => '/api/admin/maintenance', 'controller' => $C['Admin'], 'action' => 'maintenanceGet', 'opts' => ['rate_group' => 'ADMIN']];
        $R[] = ['method' => 'POST', 'pattern' => '/api/admin/maintenance', 'controller' => $C['Admin'], 'action' => 'maintenancePost', 'opts' => ['rate_group' => 'ADMIN']];
        $R[] = ['method' => 'POST', 'pattern' => '/api/admin/test-gemini', 'controller' => $C['Admin'], 'action' => 'testGemini', 'opts' => ['rate_group' => 'ADMIN']];

        $R[] = ['method' => 'GET', 'pattern' => '/api/admin/metrics', 'controller' => $C['Admin'], 'action' => 'metrics', 'opts' => ['rate_group' => 'ADMIN']];
        $R[] = ['method' => 'GET', 'pattern' => '/api/admin/users', 'controller' => $C['Admin'], 'action' => 'usersList', 'opts' => ['rate_group' => 'ADMIN']];
        $R[] = ['method' => 'POST', 'pattern' => '/api/admin/users/:id/verify', 'controller' => $C['Admin'], 'action' => 'userVerify', 'opts' => ['rate_group' => 'ADMIN']];
        $R[] = ['method' => 'POST', 'pattern' => '/api/admin/users/:id/ban', 'controller' => $C['Admin'], 'action' => 'userBan', 'opts' => ['rate_group' => 'ADMIN']];
        $R[] = ['method' => 'POST', 'pattern' => '/api/admin/users/:id/unban', 'controller' => $C['Admin'], 'action' => 'userUnban', 'opts' => ['rate_group' => 'ADMIN']];
        $R[] = ['method' => 'POST', 'pattern' => '/api/admin/users/:id/suspend7', 'controller' => $C['Admin'], 'action' => 'userSuspend7', 'opts' => ['rate_group' => 'ADMIN']];
        $R[] = ['method' => 'POST', 'pattern' => '/api/admin/users/:id/suspend', 'controller' => $C['Admin'], 'action' => 'userSuspend', 'opts' => ['rate_group' => 'ADMIN']];
        $R[] = ['method' => 'POST', 'pattern' => '/api/admin/users/:id/unsuspend', 'controller' => $C['Admin'], 'action' => 'userUnsuspend', 'opts' => ['rate_group' => 'ADMIN']];
        $R[] = ['method' => 'POST', 'pattern' => '/api/admin/backup', 'controller' => $C['Admin'], 'action' => 'backup', 'opts' => ['rate_group' => 'ADMIN']];
        $R[] = ['method' => 'POST', 'pattern' => '/api/admin/restore', 'controller' => $C['Admin'], 'action' => 'restore', 'opts' => ['rate_group' => 'ADMIN']];
        $R[] = ['method' => 'POST', 'pattern' => '/api/admin/flag', 'controller' => $C['Admin'], 'action' => 'flag', 'opts' => ['rate_group' => 'ADMIN']];
        $R[] = ['method' => 'GET', 'pattern' => '/api/admin/notifications', 'controller' => $C['Admin'], 'action' => 'notificationsList', 'opts' => ['rate_group' => 'ADMIN']];
        $R[] = ['method' => 'POST', 'pattern' => '/api/admin/notifications', 'controller' => $C['Admin'], 'action' => 'notificationsCreate', 'opts' => ['rate_group' => 'ADMIN']];
        $R[] = ['method' => 'DELETE', 'pattern' => '/api/admin/notifications/:id', 'controller' => $C['Admin'], 'action' => 'notificationsDelete', 'opts' => ['rate_group' => 'ADMIN']];
        $R[] = ['method' => 'POST', 'pattern' => '/api/admin/notifications/digests/saved-search', 'controller' => $C['NotifDigest'], 'action' => 'savedSearchDigest', 'opts' => ['rate_group' => 'ADMIN']];
        $R[] = ['method' => 'GET', 'pattern' => '/api/admin/reports', 'controller' => $C['Admin'], 'action' => 'reportsList', 'opts' => ['rate_group' => 'ADMIN']];
        $R[] = ['method' => 'POST', 'pattern' => '/api/admin/reports/:id/resolve', 'controller' => $C['Admin'], 'action' => 'reportResolve', 'opts' => ['rate_group' => 'ADMIN']];
        $R[] = ['method' => 'DELETE', 'pattern' => '/api/admin/reports/:id', 'controller' => $C['Admin'], 'action' => 'reportDelete', 'opts' => ['rate_group' => 'ADMIN']];
        $R[] = ['method' => 'GET', 'pattern' => '/api/admin/users/:id/listings', 'controller' => $C['Admin'], 'action' => 'userListings', 'opts' => ['rate_group' => 'ADMIN']];
        $R[] = ['method' => 'POST', 'pattern' => '/api/admin/listings/:id/urgent', 'controller' => $C['Admin'], 'action' => 'listingUrgent', 'opts' => ['rate_group' => 'ADMIN']];
        $R[] = ['method' => 'DELETE', 'pattern' => '/api/admin/listings/:id', 'controller' => $C['Admin'], 'action' => 'listingDelete', 'opts' => ['rate_group' => 'ADMIN']];

        // Wanted
        $R[] = ['method' => 'POST', 'pattern' => '/api/wanted/', 'controller' => $C['Wanted'], 'action' => 'create', 'opts' => ['rate_group' => 'GLOBAL']];
        $R[] = ['method' => 'GET', 'pattern' => '/api/wanted/', 'controller' => $C['Wanted'], 'action' => 'list', 'opts' => ['rate_group' => 'GLOBAL']];
        $R[] = ['method' => 'GET', 'pattern' => '/api/wanted/my', 'controller' => $C['Wanted'], 'action' => 'my', 'opts' => ['rate_group' => 'GLOBAL']];
        $R[] = ['method' => 'POST', 'pattern' => '/api/wanted/:id/close', 'controller' => $C['Wanted'], 'action' => 'close', 'opts' => ['rate_group' => 'GLOBAL']];
        $R[] = ['method' => 'POST', 'pattern' => '/api/wanted/respond', 'controller' => $C['Wanted'], 'action' => 'respond', 'opts' => ['rate_group' => 'GLOBAL']];
        $R[] = ['method' => 'POST', 'pattern' => '/api/wanted/notify-for-listing', 'controller' => $C['Wanted'], 'action' => 'notifyForListing', 'opts' => ['rate_group' => 'GLOBAL']];

        // Chats + SSE
        $R[] = ['method' => 'GET', 'pattern' => '/api/chats/', 'controller' => $C['Chats'], 'action' => 'list', 'opts' => ['rate_group' => 'GLOBAL']];
        $R[] = ['method' => 'POST', 'pattern' => '/api/chats/', 'controller' => $C['Chats'], 'action' => 'send', 'opts' => ['rate_group' => 'GLOBAL']];
        $R[] = ['method' => 'GET', 'pattern' => '/api/chats/admin/conversations', 'controller' => $C['Chats'], 'action' => 'adminConversations', 'opts' => ['rate_group' => 'ADMIN']];
        $R[] = ['method' => 'GET', 'pattern' => '/api/chats/admin/:email', 'controller' => $C['Chats'], 'action' => 'adminFetch', 'opts' => ['rate_group' => 'ADMIN']];
        $R[] = ['method' => 'POST', 'pattern' => '/api/chats/admin/:email', 'controller' => $C['Chats'], 'action' => 'adminSend', 'opts' => ['rate_group' => 'ADMIN']];

        $R[] = ['method' => 'GET', 'pattern' => '/api/chats/stream', 'controller' => $C['Chats'], 'action' => 'userStream', 'opts' => []];
        $R[] = ['method' => 'GET', 'pattern' => '/api/chats/admin/:email/stream', 'controller' => $C['Chats'], 'action' => 'adminStream', 'opts' => []];

        return $R;
    }

    public static function registerRoutes(Router $router): void
    {
        $routes = self::generateCanonical();

        foreach ($routes as $r) {
            $method = strtoupper($r['method'] ?? 'GET');
            $pattern = (string)($r['pattern'] ?? '/');
            $opts = $r['opts'] ?? [];

            if (isset($r['closure']) && is_callable($r['closure'])) {
                $router->add($method, $pattern, $r['closure'], $opts);
                continue;
            }

            $class = $r['controller'] ?? null;
            $action = $r['action'] ?? null;
            if (!$class || !$action) continue;
            if (!class_exists($class) || !method_exists($class, $action)) continue;

            // Build handler that adapts to 0-arg or 1-arg signature
            $ref = new ReflectionMethod($class, $action);
            $expectsParams = ($ref->getNumberOfParameters() >= 1);

            $handler = function (array $params = []) use ($class, $action, $expectsParams) {
                if ($expectsParams) {
                    ($class . '::' . $action)($params);
                } else {
                    ($class . '::' . $action)();
                }
            };

            $router->add($method, $pattern, $handler, $opts);
        }
    }
}