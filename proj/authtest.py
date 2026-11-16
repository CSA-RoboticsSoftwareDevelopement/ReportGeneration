from auth import get_user, authenticate, AuthError, AuthConfigurationError
import traceback

try:
    print(get_user(1))
    print("schema + query OK")
except Exception:
    traceback.print_exc()