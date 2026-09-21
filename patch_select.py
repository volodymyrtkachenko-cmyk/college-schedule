import re

with open("frontend/components/SearchableSelect.tsx", "r") as f:
    text = f.read()

old_input = """      <input
        type="text"
        disabled={disabled}
        placeholder={selected ? selected.name : placeholder}
        value={open ? query : ""}
        onFocus={() => { setOpen(true); setQuery(""); }}
        onChange={(e) => setQuery(e.target.value)}"""
        
new_input = """      <input
        type="text"
        disabled={disabled}
        placeholder={open && selected ? selected.name : placeholder}
        value={open ? query : (selected ? selected.name : "")}
        onFocus={() => { setOpen(true); setQuery(""); }}
        onChange={(e) => { 
          if (!open) setOpen(true);
          setQuery(e.target.value); 
        }}"""

text = text.replace(old_input, new_input)

with open("frontend/components/SearchableSelect.tsx", "w") as f:
    f.write(text)
