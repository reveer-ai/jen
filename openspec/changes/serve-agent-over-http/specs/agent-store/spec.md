# Spec Delta

## ADDED Requirements

### Requirement: Each saved item has a stable position
The store SHALL give each saved item a position that is greater than every position before it, and never changes or repeats, including after the store is closed and opened again. Reading the items after a position SHALL return every item saved after it, in order, each with its position. Reading after position 0 SHALL return every item.

#### Scenario: Items after a position
- **WHEN** two turns of two items each are saved, and the items after the second item's position are read
- **THEN** the second turn's two items are returned in order, each with its position

#### Scenario: Positions survive reopening
- **WHEN** a turn is saved, the store is closed and reopened, and another turn is saved
- **THEN** the first turn's items keep their positions, and the new items' positions are greater than all of them

#### Scenario: Nothing after the last item
- **WHEN** the items after the last saved item's position are read
- **THEN** no items are returned
