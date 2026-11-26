"""Bundle src/studio.html + src/engine.js into one self-contained index.html (no server, no dependencies)."""
from pathlib import Path
root = Path(__file__).parent
page = (root / "src/studio.html").read_text()
engine = (root / "src/engine.js").read_text().replace("if (typeof module !== 'undefined') module.exports = S2S;", "")
(root / "index.html").write_text(page.replace("/*ENGINE*/", engine))
print("built index.html")
