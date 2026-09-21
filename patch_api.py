import re

with open("frontend/lib/api.ts", "r") as f:
    text = f.read()

# Item 14: Refresh early token check
refresh_old = """async function refresh(): Promise<AuthSession> {
    if (!refreshPromise) {
        const token = refreshToken ?? storedRefreshToken();
        if (token) refreshToken = token;
        refreshPromise = rawRequest<AuthSession>("/api/auth/refresh", {"""
refresh_new = """async function refresh(): Promise<AuthSession> {
    if (!refreshPromise) {
        const token = refreshToken ?? storedRefreshToken();
        if (!token) {
            return Promise.reject(new ApiError(401, "Немає токена для оновлення сесії."));
        }
        refreshToken = token;
        refreshPromise = rawRequest<AuthSession>("/api/auth/refresh", {"""
text = text.replace(refresh_old, refresh_new)

# Sub request for refresh to delete `? JSON.stringify({refresh_token: token}) : undefined`
body_old = 'body: token ? JSON.stringify({refresh_token: token}) : undefined'
body_new = 'body: JSON.stringify({refresh_token: token})'
text = text.replace(body_old, body_new)

# Item 15: ForeignKey constraint in parseError
parse_err_old = 'const raw = body.detail.toLowerCase();\n            if (raw.includes("unique constraint failed")) return "Такий запис вже існує.";\n            return body.detail;'
parse_err_new = 'const raw = body.detail.toLowerCase();\n            if (raw.includes("unique constraint failed")) return "Такий запис вже існує.";\n            if (raw.includes("foreign key constraint")) return "Запис використовується в розкладі або інших даних і не може бути видалений.";\n            return body.detail;'
text = text.replace(parse_err_old, parse_err_new)

# In case it's slightly different:
if "foreign key constraint" not in text:
    text = re.sub(r'(if \(raw\.includes\("unique constraint failed"\)\) return "Такий запис вже існує\.";)', r'\1\n            if (raw.includes("foreign key constraint")) return "Запис використовується в розкладі або інших даних і не може бути видалений.";', text)


with open("frontend/lib/api.ts", "w") as f:
    f.write(text)
