from fastapi import APIRouter

router = APIRouter(tags=["health"])


@router.get("/health", summary="Check API availability")
async def health_check() -> dict[str, str]:
    return {"status": "ok"}


@router.get("/", summary="API start endpoint")
async def start() -> dict[str, str]:
    return {"message": "College Schedule API is running"}
