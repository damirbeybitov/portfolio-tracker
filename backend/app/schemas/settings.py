from pydantic import BaseModel


class UserSettingsResponse(BaseModel):
    hide_inactive_bank_accounts: bool
    model_config = {"from_attributes": True}


class UserSettingsUpdate(BaseModel):
    hide_inactive_bank_accounts: bool | None = None
