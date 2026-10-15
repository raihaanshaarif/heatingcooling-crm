import { describe, expect, it } from "vitest";
import {
  addQty,
  adjustmentFor,
  chooseUsageLocation,
  crossedBelowReorder,
  formatQty,
  isStockable,
  levelKey,
  levelsFromMovements,
  movementDeltas,
  netDelta,
  returnsForLine,
  stockStatus,
  stockValueCents,
  suggestedOrderQty,
  toCsv,
  toQty,
  validateMovement,
  type MovementLike,
} from "./inventory";

const W = "warehouse";
const VAN_JACK = "van-jack";
const VAN_LIAM = "van-liam";
const CAP = "cap";
const R32 = "r32";

const mv = (m: Partial<MovementLike> & Pick<MovementLike, "type" | "quantity">): MovementLike => ({
  inventoryItemId: CAP,
  fromLocationId: null,
  toLocationId: null,
  ...m,
});

describe("quantities", () => {
  it("adds decimals without float drift", () => {
    expect(addQty(0.1, 0.2)).toBe(0.3);
    expect(addQty(2.35, -0.35)).toBe(2);
    expect(toQty("1.256")).toBe(1.26);
    expect(toQty(null)).toBe(0);
  });

  it("formats quantities with units", () => {
    expect(formatQty(3, "each")).toBe("3");
    expect(formatQty(2.5, "kg")).toBe("2.5 kg");
    expect(formatQty(-1)).toBe("-1");
  });

  it("only stocks parts and equipment", () => {
    expect(isStockable("PART")).toBe(true);
    expect(isStockable("EQUIPMENT")).toBe(true);
    expect(isStockable("LABOUR")).toBe(false);
    expect(isStockable("CALL_OUT")).toBe(false);
  });
});

describe("movements", () => {
  it("validates the shape of each movement type", () => {
    expect(validateMovement(mv({ type: "RECEIVE", quantity: 5, toLocationId: W }))).toBeNull();
    expect(validateMovement(mv({ type: "RECEIVE", quantity: 5, fromLocationId: W }))).toMatch(
      /destination/,
    );
    expect(
      validateMovement(mv({ type: "TRANSFER", quantity: 1, fromLocationId: W, toLocationId: W })),
    ).toMatch(/different/);
    expect(validateMovement(mv({ type: "JOB_USE", quantity: 1, fromLocationId: VAN_JACK }))).toBe(
      null,
    );
    expect(validateMovement(mv({ type: "ADJUST", quantity: 0, toLocationId: W }))).toMatch(
      /more than 0/,
    );
    expect(
      validateMovement(
        mv({ type: "ADJUST", quantity: 1, fromLocationId: W, toLocationId: VAN_JACK }),
      ),
    ).toMatch(/one location/);
  });

  it("moves quantity from one location to another", () => {
    const t = mv({ type: "TRANSFER", quantity: 4, fromLocationId: W, toLocationId: VAN_JACK });
    expect(movementDeltas(t)).toEqual([
      { locationId: W, delta: -4 },
      { locationId: VAN_JACK, delta: 4 },
    ]);
    expect(netDelta(t)).toBe(0);
    expect(netDelta(mv({ type: "JOB_USE", quantity: 1.5, fromLocationId: VAN_JACK }))).toBe(-1.5);
  });

  it("rebuilds levels from the ledger, allowing negative stock", () => {
    const ledger: MovementLike[] = [
      mv({ type: "RECEIVE", quantity: 10, toLocationId: W }),
      mv({ type: "TRANSFER", quantity: 3, fromLocationId: W, toLocationId: VAN_JACK }),
      mv({ type: "JOB_USE", quantity: 1, fromLocationId: VAN_JACK }),
      mv({ type: "JOB_USE", quantity: 2, fromLocationId: VAN_LIAM }),
      mv({ inventoryItemId: R32, type: "RECEIVE", quantity: 9.5, toLocationId: W }),
      mv({ inventoryItemId: R32, type: "JOB_USE", quantity: 0.75, fromLocationId: W }),
      mv({ type: "ADJUST", quantity: 1, fromLocationId: W }),
    ];
    const levels = levelsFromMovements(ledger);
    expect(levels.get(levelKey(CAP, W))).toBe(6);
    expect(levels.get(levelKey(CAP, VAN_JACK))).toBe(2);
    expect(levels.get(levelKey(CAP, VAN_LIAM))).toBe(-2);
    expect(levels.get(levelKey(R32, W))).toBe(8.75);
  });
});

describe("low stock", () => {
  it("classifies totals against the reorder level", () => {
    expect(stockStatus(5, 2)).toBe("OK");
    expect(stockStatus(2, 2)).toBe("OK");
    expect(stockStatus(1, 2)).toBe("LOW");
    expect(stockStatus(0, 2)).toBe("OUT");
    expect(stockStatus(-1, 2)).toBe("NEGATIVE");
    expect(stockStatus(0, 0)).toBe("OK");
    expect(stockStatus(-0.5, 0)).toBe("NEGATIVE");
  });

  it("notifies only when the total first drops below the reorder level", () => {
    expect(crossedBelowReorder(3, 1, 2)).toBe(true);
    expect(crossedBelowReorder(2, 1.5, 2)).toBe(true);
    expect(crossedBelowReorder(1, 0, 2)).toBe(false); // already low
    expect(crossedBelowReorder(5, 2, 2)).toBe(false); // at the level, not below
    expect(crossedBelowReorder(5, 0, 0)).toBe(false); // no reorder level
  });

  it("suggests an order back up to twice the reorder level", () => {
    expect(suggestedOrderQty(1, 4)).toBe(7);
    expect(suggestedOrderQty(-2, 3)).toBe(8);
    expect(suggestedOrderQty(10, 4)).toBe(0);
    expect(suggestedOrderQty(0, 0)).toBe(0);
  });
});

describe("job usage", () => {
  const vans = [
    { id: VAN_JACK, userId: "jack" },
    { id: VAN_LIAM, userId: "liam" },
  ];

  it("takes parts from the van of the technician adding them", () => {
    expect(
      chooseUsageLocation({
        actingUserId: "liam",
        assignedUserIds: ["jack", "liam"],
        vans,
        warehouseId: W,
      }),
    ).toBe(VAN_LIAM);
  });

  it("uses the first assigned technician's van when the office adds parts", () => {
    expect(
      chooseUsageLocation({
        actingUserId: "office",
        assignedUserIds: ["owner", "jack"],
        vans,
        warehouseId: W,
      }),
    ).toBe(VAN_JACK);
  });

  it("falls back to the warehouse", () => {
    expect(
      chooseUsageLocation({ actingUserId: "office", assignedUserIds: [], vans, warehouseId: W }),
    ).toBe(W);
    expect(
      chooseUsageLocation({
        actingUserId: "owner",
        assignedUserIds: ["owner"],
        vans,
        warehouseId: W,
      }),
    ).toBe(W);
  });

  it("returns what is still out for a removed line, to where it came from", () => {
    const ledger: MovementLike[] = [
      mv({ type: "JOB_USE", quantity: 2, fromLocationId: VAN_JACK }),
      mv({ type: "JOB_USE", quantity: 1, fromLocationId: W }),
      mv({ type: "JOB_RETURN", quantity: 1, toLocationId: VAN_JACK }),
    ];
    expect(returnsForLine(ledger)).toEqual([
      { inventoryItemId: CAP, locationId: VAN_JACK, quantity: 1 },
      { inventoryItemId: CAP, locationId: W, quantity: 1 },
    ]);
    expect(
      returnsForLine([...ledger, mv({ type: "JOB_RETURN", quantity: 1, toLocationId: VAN_JACK })]),
    ).toEqual([{ inventoryItemId: CAP, locationId: W, quantity: 1 }]);
    expect(returnsForLine([])).toEqual([]);
  });

  it("deducting then removing a line leaves stock where it started", () => {
    const start = mv({ type: "RECEIVE", quantity: 1, toLocationId: VAN_JACK });
    const use = mv({ type: "JOB_USE", quantity: 2, fromLocationId: VAN_JACK });
    const afterUse = levelsFromMovements([start, use]);
    expect(afterUse.get(levelKey(CAP, VAN_JACK))).toBe(-1); // allowed, flagged in the UI
    const back = returnsForLine([use]).map((r) =>
      mv({ type: "JOB_RETURN", quantity: r.quantity, toLocationId: r.locationId }),
    );
    expect(levelsFromMovements([start, use, ...back]).get(levelKey(CAP, VAN_JACK))).toBe(1);
  });
});

describe("stocktake", () => {
  it("turns a counted quantity into one adjustment", () => {
    expect(
      adjustmentFor({
        inventoryItemId: CAP,
        locationId: W,
        current: 7,
        mode: "set",
        quantity: 5,
      }),
    ).toEqual({
      inventoryItemId: CAP,
      type: "ADJUST",
      quantity: 2,
      fromLocationId: W,
      toLocationId: null,
    });
    expect(
      adjustmentFor({
        inventoryItemId: R32,
        locationId: VAN_JACK,
        current: -1,
        mode: "set",
        quantity: 2.5,
      }),
    ).toMatchObject({ quantity: 3.5, toLocationId: VAN_JACK, fromLocationId: null });
    expect(
      adjustmentFor({ inventoryItemId: CAP, locationId: W, current: 4, mode: "set", quantity: 4 }),
    ).toBeNull();
  });

  it("adds or removes an amount", () => {
    expect(
      adjustmentFor({ inventoryItemId: CAP, locationId: W, current: 4, mode: "add", quantity: 2 }),
    ).toMatchObject({ quantity: 2, toLocationId: W });
    expect(
      adjustmentFor({
        inventoryItemId: CAP,
        locationId: W,
        current: 4,
        mode: "remove",
        quantity: 6,
      }),
    ).toMatchObject({ quantity: 6, fromLocationId: W });
  });
});

describe("value and export", () => {
  it("values stock at cost, ignoring negative quantities", () => {
    expect(stockValueCents(2.5, 3500)).toBe(8750);
    expect(stockValueCents(-3, 1800)).toBe(0);
  });

  it("builds CSV with quoting", () => {
    expect(
      toCsv([
        ["Item", "Qty"],
        ['Bracket, "heavy"', 2],
        [null, 1.5],
      ]),
    ).toBe('Item,Qty\r\n"Bracket, ""heavy""",2\r\n,1.5\r\n');
  });
});
