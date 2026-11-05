from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    DATABASE_URL: str = "postgresql+psycopg2://ticket:ticket_pwd_2026@localhost:5440/ticket"
    JWT_SECRET: str = "change-me-to-a-long-random-string-before-prod"
    JWT_EXPIRE_HOURS: int = 12
    ADMIN_USERNAME: str = "admin"
    ADMIN_PASSWORD: str = "admin123"
    UPLOAD_DIR: str = "./uploads"

    class Config:
        env_file = ".env"


settings = Settings()
