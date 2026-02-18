from app.core.config import settings
from app.core.logging import configure_logging

configure_logging(settings.log_level)
