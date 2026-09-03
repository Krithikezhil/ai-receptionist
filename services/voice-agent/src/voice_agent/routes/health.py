from fastapi import APIRouter

from voice_agent.services.health import HealthStatus, get_health_status

router = APIRouter()


@router.get("/health")
def health() -> HealthStatus:
    return get_health_status()
