from pydantic import BaseModel


class RequestMeta(BaseModel):
    request_id: str
