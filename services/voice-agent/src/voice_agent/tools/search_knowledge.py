"""The one read-only function-calling tool for M5: live knowledge search.

Everything else the receptionist needs (business profile/hours/services/
receptionist config) is prefetched once into the system prompt at session
start (see runtime/context.py) because it's small and bounded — knowledge
is the one thing that needs live querying mid-conversation, since it can
grow arbitrarily large. No write-capable tool exists — read-only by design,
per the M5 scope boundary. See ARCHITECTURE.md "Tools".
"""

from __future__ import annotations

from pipecat.adapters.schemas.function_schema import FunctionSchema
from pipecat.services.llm_service import FunctionCallParams

from voice_agent.clients.api_client import ApiClient, ApiClientError

SEARCH_KNOWLEDGE_FUNCTION_NAME = "search_knowledge"


def build_search_knowledge_schema(api_client: ApiClient, organization_id: str) -> FunctionSchema:
    """Builds the tool's schema+handler, bound to one session's org/client.

    The handler is embedded directly on the schema (Pipecat auto-registers
    it wherever the schema is advertised in the LLMContext), so wiring this
    tool into a session is just adding the returned schema to that
    session's `LLMContext(tools=...)` — see pipeline.py.
    """

    async def handler(params: FunctionCallParams) -> None:
        query = params.arguments.get("query")
        category = params.arguments.get("category")

        try:
            entries = await api_client.search_knowledge(
                organization_id,
                query=query if isinstance(query, str) and query else None,
                category=category if isinstance(category, str) and category else None,
            )
        except ApiClientError as exc:
            # A failed lookup is not a crash: the LLM gets a structured
            # error it can react to (e.g. fall back to
            # receptionistConfig.fallbackMessage), matching the "runtime
            # failure handling" requirement — never let a tool failure take
            # down the whole session. See SECURITY.md "Failure handling".
            await params.result_callback({"error": str(exc)})
            return

        await params.result_callback(
            {
                "results": [
                    {"title": entry.title, "content": entry.content, "category": entry.category}
                    for entry in entries
                ]
            }
        )

    return FunctionSchema(
        name=SEARCH_KNOWLEDGE_FUNCTION_NAME,
        description=(
            "Search this business's knowledge base (FAQs, policies, service info) for "
            "information relevant to the caller's question. Read-only — cannot create, "
            "update, or delete anything."
        ),
        properties={
            "query": {
                "type": "string",
                "description": "Keywords from the caller's question to search for.",
            },
            "category": {
                "type": "string",
                "enum": ["faq", "policy", "service_info", "custom"],
                "description": "Optional category to narrow the search.",
            },
        },
        required=["query"],
        handler=handler,
    )
