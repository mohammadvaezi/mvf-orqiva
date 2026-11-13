# Criticals — must never break (fixture)

| # | Critical | Why | Guarded by |
|---|----------|-----|------------|
| 1 | The sample never charges twice | double charge = refund | sample.test.ts |
| 2 | Fixture data contains no real ids | tests must be shareable | fixture review |
