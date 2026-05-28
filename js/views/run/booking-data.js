/** Filter API booking rentals by visible roster-size toggles. */
export function filterBookingRentalsByDate(run, visibleRosterSizes) {
  const merged = run.bookingRentalsByDate;
  if (merged?.length) {
    return merged
      .map((dg) => ({
        ...dg,
        options: (dg.options || []).filter((o) =>
          visibleRosterSizes.includes(Number(o.rosterCapacity))
        ),
      }))
      .filter((dg) => dg.options.length > 0);
  }
  const bySize = run.bookingRentalGroupsBySize;
  if (bySize && visibleRosterSizes.length) {
    const out = [];
    for (const size of visibleRosterSizes) {
      for (const dg of bySize[size] || bySize[String(size)] || []) {
        const existing = out.find((x) => x.date === dg.date);
        const opts = (dg.options || []).filter(
          (o) => Number(o.rosterCapacity) === size
        );
        if (!opts.length) continue;
        if (existing) existing.options.push(...opts);
        else out.push({ ...dg, options: [...opts] });
      }
    }
    out.sort((a, b) => a.date.localeCompare(b.date));
    for (const g of out) {
      g.options.sort((a, b) =>
        String(a.slotStart).localeCompare(String(b.slotStart))
      );
    }
    return out;
  }
  return [];
}

export function hasBookingRentals(bookingRentalsByDate) {
  return bookingRentalsByDate.some((dg) => dg.options?.length);
}
