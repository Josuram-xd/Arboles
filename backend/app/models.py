"""Scene, Option and Effects models (pydantic v2)."""

from typing import Literal

from pydantic import BaseModel, Field, model_validator

Ending = Literal["victory", "death"]
Enemy = Literal["walker", "runner", "brute", "horde"]
Escape = Literal["helicopter", "neighbor", "sewers"]


class Effects(BaseModel):
    health: int = Field(default=0, ge=-3, le=3)
    supplies: int = Field(default=0, ge=-3, le=3)
    noise: int = Field(default=0, ge=-3, le=3)


class Option(BaseModel):
    text: str = Field(min_length=1)
    target: str = Field(min_length=1)
    effects: Effects = Field(default_factory=Effects)


class Scene(BaseModel):
    id: str = Field(min_length=1)
    title: str = Field(min_length=1)
    text: str = Field(min_length=1)
    ending: Ending | None = None
    escape: Escape | None = None
    enemy: Enemy | None = None
    options: list[Option] = Field(default_factory=list)

    @model_validator(mode="after")
    def _check_consistency(self):
        if self.ending is not None and self.options:
            raise ValueError("an ending scene cannot have options")
        if self.ending is None and not self.options:
            raise ValueError("a non-ending scene needs at least one option")
        if self.ending == "victory" and self.escape is None:
            raise ValueError("a victory scene needs an escape type")
        if self.ending != "victory" and self.escape is not None:
            raise ValueError("only victory scenes can have an escape type")
        return self
