# In-world link message protocol

LSL has no include mechanism, so these numbers are repeated as constants at the
top of each script. They are the contract between them - change one, change all.

`llMessageLinked(LINK_SET, num, str, id)`

| num | Name | Direction | `str` | `id` |
|-----|------|-----------|-------|------|
| 100 | `MI_NET_SEND` | any -> net_bridge | `endpoint\|jsonBody` | avatar, if any |
| 101 | `MI_NET_RECV` | net_bridge -> any | command JSON from backend | - |
| 102 | `MI_NET_STATUS` | net_bridge -> any | `online` \| `offline` | - |
| 110 | `MI_MOAP_SET` | any -> moap | absolute url | - |
| 111 | `MI_MOAP_HOME` | any -> moap | - | - |
| 112 | `MI_MOAP_IDLE` | idle -> moap | - | - |
| 120 | `MI_CFG_GET` | any -> settings | key | requester |
| 121 | `MI_CFG_VALUE` | settings -> any | `key\|value` | requester |
| 122 | `MI_CFG_SET` | any -> settings | `key\|value` | - |
| 130 | `MI_PERM_CHECK` | any -> permission | action name | avatar |
| 131 | `MI_PERM_RESULT` | permission -> any | `1\|action` or `0\|reason` | avatar |
| 140 | `MI_PRESENCE` | presence -> any | comma separated `key\|name\|group` | - |
| 150 | `MI_MSG_OUT` | any -> messaging | `target\|text` | sender |
| 151 | `MI_MSG_IN` | messaging -> any | `name\|text` | sender |
| 160 | `MI_SYNC_CMD` | any -> sync | `action\|value` | avatar |
| 161 | `MI_SYNC_STATE` | sync -> any | compact state JSON | - |
| 170 | `MI_ACTIVITY` | any -> idle | - | - |
| 171 | `MI_IDLE_ENTER` | idle -> any | - | - |
| 172 | `MI_IDLE_EXIT` | idle -> any | - | - |
| 180 | `MI_GAME` | any -> game | `action\|game` | avatar |
| 190 | `MI_MENU` | any -> core | menu name | avatar |

## Why the scripts are split this way

One script per concern, and exactly one script (`net_bridge`) that performs
HTTP. That matters for a reason specific to Second Life: `llHTTPRequest` is
throttled at roughly **25 requests per 20 seconds per owner per region**, shared
across every script that owner has running there. Funnelling all traffic through
one script means that budget is spent deliberately instead of being raced for.

Memory is the other reason. A Mono script gets 64 KB. Ten focused scripts each
comfortably inside that limit is a working TV; one large script is a stack-heap
collision waiting for the first busy sim.
