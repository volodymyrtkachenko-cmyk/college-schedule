import hashlib
import httpx
from typing import Tuple, Optional

class ScheduleFetcher:
    def __init__(self, url: str):
        self.url = url
        self.headers = {
            "User-Agent": "KRE-Schedule-Fetcher/1.0 (+https://github.com/admin/college-schedule)"
        }

    async def fetch(self) -> Tuple[str, str]:
        """
        Returns (html_content, content_hash)
        """
        async with httpx.AsyncClient(timeout=15.0) as client:
            response = await client.get(self.url, headers=self.headers)
            response.raise_for_status()
            html = response.text
            content_hash = hashlib.sha256(html.encode("utf-8")).hexdigest()
            return html, content_hash
