import os
import sys


ROOT = os.path.dirname(os.path.dirname(os.path.dirname(__file__)))
WORKER_ROOT = os.path.join(ROOT, "services", "worker")
API_ROOT = os.path.join(ROOT, "services", "api")
SCRAPER_ROOT = os.path.join(ROOT, "services", "scraper")
SHARED_ROOT = os.path.join(ROOT, "shared")

for path in (ROOT, WORKER_ROOT, API_ROOT, SCRAPER_ROOT, SHARED_ROOT):
    if path not in sys.path:
        sys.path.append(path)
