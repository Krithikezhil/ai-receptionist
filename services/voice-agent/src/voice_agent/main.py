from fastapi import FastAPI

from voice_agent.config import get_settings
from voice_agent.routes.health import router as health_router
from voice_agent.routes.twilio import create_twilio_router


def create_app() -> FastAPI:
    app = FastAPI(title="AI Receptionist Voice Agent", version="0.1.0")
    app.include_router(health_router)
    app.include_router(create_twilio_router(get_settings()))
    return app


app = create_app()


def main() -> None:
    import uvicorn

    from voice_agent.config import get_settings

    settings = get_settings()
    uvicorn.run("voice_agent.main:app", host="0.0.0.0", port=settings.port)


if __name__ == "__main__":
    main()
