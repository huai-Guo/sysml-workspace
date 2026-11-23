import argparse
import os

from .store import Store, migrate

parser = argparse.ArgumentParser()
parser.add_argument("command", choices=["migrate", "cleanup"])
args = parser.parse_args()
if args.command == "migrate":
    migrate(os.environ["RAG_DATABASE_URL"])
else:
    store = Store(os.environ["RAG_DATABASE_URL"])
    try:
        print({"deleted_documents": store.cleanup()})
    finally:
        store.pool.close()
