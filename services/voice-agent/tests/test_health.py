from fastapi.testclient import TestClient

from voice_agent.main import create_app


def test_health_returns_ok() -> None:
    client = TestClient(create_app())

    response = client.get("/health")

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert body["service"] == "voice-agent"
    assert isinstance(body["uptime_seconds"], int)
