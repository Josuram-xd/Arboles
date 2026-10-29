"""Scene and Option models (pydantic v2)."""

from typing import Literal

from pydantic import BaseModel, Field, model_validator

Ending = Literal["victory", "death"]


class Option(BaseModel):
    text: str = Field(min_length=1)
    target: str = Field(min_length=1)


class Scene(BaseModel):
    id: str = Field(min_length=1)
    title: str = Field(min_length=1)
    text: str = Field(min_length=1)
    ending: Ending | None = None
    options: list[Option] = Field(default_factory=list)

    @model_validator(mode="after")
    def _check_options_match_ending(self):
        if self.ending is not None and self.options:
            raise ValueError("an ending scene cannot have options")
        if self.ending is None and not self.options:
            raise ValueError("a non-ending scene needs at least one option")
        return self
