import os
import sys


ROOT = os.path.dirname(os.path.dirname(__file__))
WORKER_ROOT = os.path.join(ROOT, "services", "worker")

if WORKER_ROOT not in sys.path:
    sys.path.insert(0, WORKER_ROOT)
