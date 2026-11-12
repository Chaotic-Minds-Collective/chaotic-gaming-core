# ATLAS Data Model

ATLAS is modeled around a cluster containing multiple maps/grids, each hosted by a server. Characters can move between maps. Character identifiers are scoped to a map; tribe identifiers are scoped to a cluster. Do not assume display names are unique or stable.

The first integration milestone should confirm which identifiers and transfer events the installed server API exposes. Persist raw provider IDs as text and retain transfer state for reconciliation.
