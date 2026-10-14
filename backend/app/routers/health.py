from fastapi import APIRouter, Depends, Request
from app.core.security import require_roles

router = APIRouter(prefix="/health", tags=["health"])

@router.get("")
@router.get("/")
async def health_check():
    return {"status": "ok"}

@router.get("/ip")
async def get_test_ip(request: Request, _: object = Depends(require_roles("admin"))):
    return {
        "client_host": request.client.host if request.client else None,
        "x_forwarded_for": request.headers.get("x-forwarded-for"),
        "x_real_ip": request.headers.get("x-real-ip"),
    }
