from __future__ import annotations

import argparse
import asyncio
import json

from .database import Database, Owner, migrate
from .settings import Settings


def main():
    parser = argparse.ArgumentParser(description="SysML Agent service operations")
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("migrate")
    commands.add_parser("cleanup")
    commands.add_parser("doctor")
    api = commands.add_parser("api")
    api.add_argument("--host", default="127.0.0.1")
    api.add_argument("--port", type=int, default=8000)
    worker = commands.add_parser("worker")
    worker.add_argument("--concurrency", type=int, default=2)
    for name in ("issue-token", "revoke-user"):
        command = commands.add_parser(name)
        command.add_argument("--tenant", required=True)
        command.add_argument("--user", required=True)
        if name == "issue-token":
            command.add_argument("--label", default="access")
            command.add_argument("--days", type=int, default=90)
    args = parser.parse_args()
    settings = Settings.from_env()
    if args.command == "migrate":
        migrate(settings.database_url)
        print("Database migrations applied.")
    elif args.command == "api":
        import uvicorn

        uvicorn.run(
            "sysml_workspace.server.api:create_app",
            factory=True,
            host=args.host,
            port=args.port,
            access_log=False,
            proxy_headers=False,
            limit_concurrency=200,
            timeout_keep_alive=10,
        )
    elif args.command == "worker":
        from .worker import serve_worker

        if not 1 <= args.concurrency <= 32:
            parser.error("--concurrency must be between 1 and 32")
        asyncio.run(serve_worker(settings, args.concurrency))
    else:
        db = Database(settings)
        try:
            if args.command == "issue-token":
                token = db.issue_token(Owner(args.tenant, args.user), args.label, args.days)
                print(json.dumps({"access_token": token, "expires_in_days": args.days}))
            elif args.command == "revoke-user":
                db.revoke_tokens(Owner(args.tenant, args.user))
                print("User tokens revoked.")
            elif args.command == "cleanup":
                print(json.dumps({"deleted_sessions": db.cleanup()}))
            else:
                print(json.dumps(db.readiness()))
        finally:
            db.close()


if __name__ == "__main__":
    main()
