"""Modelos de una escena de la aventura (pydantic v2)."""

from typing import Literal

from pydantic import BaseModel, Field, model_validator

Final = Literal["victoria", "muerte"]


class Opcion(BaseModel):
    texto: str = Field(min_length=1)
    destino: str = Field(min_length=1)


class Escena(BaseModel):
    id: str = Field(min_length=1)
    titulo: str = Field(min_length=1)
    texto: str = Field(min_length=1)
    final: Final | None = None
    opciones: list[Opcion] = Field(default_factory=list)

    @model_validator(mode="after")
    def _validar_opciones_segun_final(self):
        if self.final is not None and self.opciones:
            raise ValueError("una escena final no puede tener opciones")
        if self.final is None and not self.opciones:
            raise ValueError("una escena no final necesita al menos una opcion")
        return self
