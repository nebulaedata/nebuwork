"""v3 pydantic schemas for model output."""
from __future__ import annotations

from typing import List, Literal, Optional

from pydantic import Field

from ..models import Strict


class V3Evidence(Strict):
    unit_id: str = Field(min_length=1)
    quote: str = Field(min_length=1)
    clause: Optional[str] = None


class V3Record(Strict):
    type: Literal['requirement', 'definition', 'explanation', 'other']
    subject: Optional[str] = None
    conditions: Optional[str] = None
    content: str = Field(min_length=1)
    exceptions: List[str] = Field(default_factory=list)
    references: List[str] = Field(default_factory=list)
    relations: List[str] = Field(default_factory=list)
    primary_unit_id: str = Field(min_length=1)
    evidence: List[V3Evidence] = Field(min_length=1)


class V3Coverage(Strict):
    unit_id: str = Field(min_length=1)
    disposition: Literal['extracted', 'context_only', 'ignored', 'needs_review']
    reason: str = ''


class V3BlockResult(Strict):
    records: List[V3Record] = Field(default_factory=list)
    coverage: List[V3Coverage] = Field(default_factory=list)
