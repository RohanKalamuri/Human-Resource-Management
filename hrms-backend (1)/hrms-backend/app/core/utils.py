"""
Small shared helpers used by multiple routers to avoid repeating
ObjectId parsing and Mongo-document-to-schema conversion boilerplate.
"""
from typing import Any

from bson import ObjectId
from bson.errors import InvalidId
from fastapi import HTTPException, status


def parse_object_id(raw_id: str, entity_name: str = "resource") -> ObjectId:
    """
    Convert a string into a Mongo ObjectId, raising a clean 400 error
    (instead of an unhandled 500) if the string is not a valid ObjectId.
    """
    try:
        return ObjectId(raw_id)
    except (InvalidId, TypeError):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"'{raw_id}' is not a valid {entity_name} id.",
        )


def stringify_id(document: dict[str, Any]) -> dict[str, Any]:
    """Mutate a Mongo document in place, converting its `_id` to a string."""
    if document is not None and "_id" in document:
        document["_id"] = str(document["_id"])
    return document
