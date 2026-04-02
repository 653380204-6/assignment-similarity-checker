def test_root(client):
    response = client.get("/")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "running"


def test_health(client):
    response = client.get("/health")
    assert response.status_code == 200
    data = response.json()
    assert data["api"] == "healthy"


def test_auth_me(client):
    response = client.get("/auth/me")
    assert response.status_code == 200
    data = response.json()
    assert data["id"] == "test-user"
    assert data["email"] == "test@example.com"
