from pydantic import BaseModel, Field


class ParsedSection(BaseModel):
    heading: str
    text: str
    page: int | None = None


class ParsedDocument(BaseModel):
    title: str
    abstract: str
    sections: list[ParsedSection] = Field(default_factory=list)
