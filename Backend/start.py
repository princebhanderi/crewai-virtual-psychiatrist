import os

# Ensure Render's PORT is used
os.environ["PORT"] = os.environ.get("PORT", "8000")

# Import and run the application
from crewai import run

run()
