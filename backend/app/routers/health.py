from fastapi import APIRouter

router = APIRouter(prefix="/health", tags=["health"])

@router.get("")
@router.get("/")
async def health_check():
    return {"status": "ok"}

from fastapi import Request

@router.get("/ip")
async def get_test_ip(request: Request):
    return {
        "client_host": request.client.host if request.client else None,
        "x_forwarded_for": request.headers.get("x-forwarded-for"),
        "x_real_ip": request.headers.get("x-real-ip")
    }
