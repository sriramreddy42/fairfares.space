# FairFares k6 load suite

This suite runs realistic, authenticated mobile/API journeys against an isolated local database. It blocks production and blocks high-volume remote runs unless an explicit risk acknowledgement is supplied.

```bash
python3 scripts/run_k6_load.py smoke
python3 scripts/run_k6_load.py normal
python3 scripts/run_k6_load.py 100
python3 scripts/run_k6_load.py medium
python3 scripts/run_k6_load.py high
python3 scripts/run_k6_load.py stress
python3 scripts/run_k6_load.py spike
```

Run profiles in order and stop when thresholds fail. Results are written to `artifacts/k6/<profile>.json`. The workload mixes housing search/history, carpool search/history, rental search/bookings, Chitthi inbox/public communities, bootstrap, and dynamic location suggestions with normal user think time.
