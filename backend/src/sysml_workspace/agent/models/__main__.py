from __future__ import annotations

import argparse
import asyncio
import json

from .config import ModelGatewayConfig
from .contracts import ModelMessage, ModelRequest
from .factory import create_model_gateway


async def _run(prompt: str, system: str | None) -> None:
    config = ModelGatewayConfig.from_env()
    gateway = create_model_gateway(config)

    messages = []
    if system:
        messages.append(ModelMessage(role="system", content=system))
    messages.append(ModelMessage(role="user", content=prompt))

    response = await gateway.generate(ModelRequest(messages=messages))
    print(
        json.dumps(
            {
                "provider": response.provider,
                "model": response.model,
                "text": response.text,
                "usage": {
                    "input_tokens": response.usage.input_tokens,
                    "output_tokens": response.usage.output_tokens,
                    "total_tokens": response.usage.total_tokens,
                },
                "finish_reason": response.finish_reason,
                "response_id": response.response_id,
            },
            ensure_ascii=False,
            indent=2,
        )
    )


def main() -> None:
    parser = argparse.ArgumentParser(description="Probe the configured ModelGateway.")
    parser.add_argument("prompt")
    parser.add_argument("--system")
    args = parser.parse_args()
    asyncio.run(_run(args.prompt, args.system))


if __name__ == "__main__":
    main()
