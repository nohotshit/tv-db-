#!/usr/bin/env python3
"""
Structural checker for the LSL scripts.

There is no LSL compiler outside the viewer, so this catches the classes of
mistake that would otherwise only appear as a red error line in world:

  * unbalanced braces, parentheses or brackets
  * a user function called before it is declared (LSL requires declaration
    first, and this is the single easiest way to break a script)
  * events used that are not real LSL events, usually a typo
  * a `default` state that is missing entirely

It is not a type checker and does not pretend to be. It is the cheap 90%.
"""
import re, sys, pathlib

EVENTS = {
    'state_entry','state_exit','touch_start','touch','touch_end','collision_start',
    'collision','collision_end','land_collision_start','land_collision','land_collision_end',
    'timer','listen','sensor','no_sensor','control','at_target','not_at_target',
    'at_rot_target','not_at_rot_target','money','email','run_time_permissions',
    'changed','attach','dataserver','moving_start','moving_end','on_rez','object_rez',
    'link_message','remote_data','http_response','http_request','transaction_result',
    'path_update','experience_permissions','experience_permissions_denied',
    'linkset_data','final_damage','on_damage','on_death'
}

# Words LSL reserves. Using one as a variable name is a syntax error, not a
# style problem, and the compiler reports it at a confusing offset - which is
# why this check exists rather than relying on spotting it by eye.
RESERVED = {
    'integer','float','string','key','vector','rotation','quaternion','list',
    'default','state','event','jump','return','if','else','for','do','while',
    'print','TRUE','FALSE','NULL_KEY','PI','ZERO_VECTOR','ZERO_ROTATION','EOF'
}
TYPES_RE = r'(?:integer|float|string|key|vector|rotation|quaternion|list)'
DECL_NAME = re.compile(chr(92) + 'b(' + TYPES_RE + ')' + chr(92) + 's+'
                       + '([A-Za-z_]' + chr(92) + 'w*)' + chr(92) + 's*'
                       + '(?==|;|,|\\)|' + chr(92) + 's)')

# Declarations look like:  name(args)  or  type name(args)  at column 0
DECL = re.compile(r'^(?:(integer|float|string|key|vector|rotation|list)\s+)?([A-Za-z_]\w*)\s*\(')
CALL = re.compile(r'\b([A-Za-z_]\w*)\s*\(')

def strip_noise(text):
    """Remove string literals and comments so punctuation inside them is not counted.

    Order matters: strings come out FIRST. Doing comments first eats the "//"
    inside a url like "https://example.com/" and swallows the rest of the line,
    which shows up later as phantom unbalanced braces.
    """
    text = text.replace(chr(92) + chr(34), "")      # escaped quotes
    text = re.sub(chr(34) + "[^" + chr(34) + "]*" + chr(34), chr(34) * 2, text)
    text = re.sub("//[^" + chr(10) + "]*", "", text)
    return text

def check(path):
    raw = path.read_text(encoding='utf-8')
    code = strip_noise(raw)
    problems = []

    for open_c, close_c, label in (('{','}','braces'), ('(',')','parentheses'), ('[',']','brackets')):
        diff = code.count(open_c) - code.count(close_c)
        if diff:
            problems.append(f'unbalanced {label}: {diff:+d}')

    if not re.search(r'^default\s*$', code, re.M) and 'default' not in code:
        problems.append('no default state')

    # Function declarations at column 0, outside any state block.
    lines = code.split('\n')
    declared, order = {}, []
    in_state = False
    depth = 0
    for i, line in enumerate(lines):
        depth += line.count('{') - line.count('}')
        if re.match(r'^(default|state\s+\w+)\s*$', line.strip()):
            in_state = True
        m = DECL.match(line)
        if m and not in_state and depth <= 1:
            name = m.group(2)
            if name not in EVENTS and not name.startswith('ll'):
                declared[name] = i
                order.append(name)

    # A call to a declared function that appears before its declaration line.
    for i, line in enumerate(lines):
        for m in CALL.finditer(line):
            name = m.group(1)
            if name in declared and DECL.match(line) is None:
                if i < declared[name]:
                    problems.append(
                        f'line {i+1}: calls "{name}" before it is declared on line {declared[name]+1}')

    # A reserved word used as a variable name.
    for i, line in enumerate(lines):
        for m in DECL_NAME.finditer(line):
            typ, nm = m.group(1), m.group(2)
            if nm in RESERVED:
                problems.append(
                    f'line {i+1}: "{nm}" is a reserved LSL word and cannot name a '
                    f'variable (declared as "{typ} {nm}")')

    # Event names inside states must be real events.
    for i, line in enumerate(lines):
        m = re.match(r'^\s{4}([a-z_]\w*)\s*\(', line)
        if not m:
            continue
        name = m.group(1)
        # An event declaration opens a block; a call is a statement ending in
        # a semicolon. Built-ins all start with "ll" and are never events.
        if name.startswith('ll') or line.rstrip().endswith(';'):
            continue
        if name not in EVENTS and name not in declared:
            if not line.strip().startswith(('if','else','while','for','return','//')):
                problems.append(f'line {i+1}: "{name}" is not an LSL event')

    return problems, len(declared)

def main():
    root = pathlib.Path('second-life')
    files = sorted(root.rglob('*.lsl'))
    if not files:
        print('no .lsl files found'); return 1
    failed = 0
    for f in files:
        problems, nfun = check(f)
        if problems:
            failed += 1
            print(f'FAIL {f}')
            for p in problems:
                print(f'      {p}')
        else:
            print(f'ok   {f}  ({nfun} functions)')
    print()
    print(f'{len(files)} scripts checked, {failed} with problems')
    return 1 if failed else 0

sys.exit(main())
