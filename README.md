# Examination Timetable Scheduling — an application of vertex colouring

DMGT Group Experiential Learning project. An interactive website that reads student–course registrations, builds the examination **conflict graph** automatically, colours it with **Greedy, Welsh–Powell, DSATUR** and an **exact branch-and-bound** method, verifies every edge, and turns colour classes into exam time slots. A second mode colours any simple graph with up to 50 vertices and 50 edges.

**Live site:** `https://ayush12182.github.io/exam-scheduler/` *(after you enable GitHub Pages, see below)*

## Features

| Requirement | Where |
|---|---|
| Registration input: typed / pasted / CSV upload, validation of missing values, invalid codes, repeated student–course pairs | Mode ①, `parseRegistrations()` in `js/engine.js` |
| Automatic conflict construction (no hand-entered edges) | `buildConflictGraph()` |
| Graph visualisation (own SVG renderer, draggable, edge tooltips show the students who cause each conflict) | `js/graphview.js` |
| Greedy, Welsh–Powell, DSATUR (all implemented from scratch) | `greedy()`, `welshPowell()`, `dsatur()` |
| Timetable from colour classes, CSV download | `buildTimetable()` + results panel |
| Correctness check of every edge and of every student’s exams | `verify()`, `buildTimetable().clashes` |
| Optimality: maximum-clique lower bound + DSATUR branch-and-bound | `maxClique()`, `exactChromatic()` |
| Dynamic update: add / edit / remove a student, graph and timetable regenerate and the change is listed | “Dynamic update” card |
| General mode: arbitrary graph, 1 ≤ \|V\| ≤ 50, 0 ≤ \|E\| ≤ 50; rejects self-loops, duplicate edges, unknown labels, over-limit input | Mode ②, `parseGeneralGraph()` |
| Both modes share one colouring engine | `js/engine.js` |
| Step-by-step animation, algorithm comparison with timings, reset | Graph panel, comparison table, ↺ Reset |

## Project structure

```
index.html            page layout
css/style.css         styling
js/engine.js          ALL mathematics: parsing, graph construction, algorithms, verification (shared by both modes + tests)
js/graphview.js       SVG graph drawing (circular / force-directed layout)
js/app.js             UI controller
js/samples.js         sample INPUT data only (generated from data/)
data/                 supplied dataset, modified dataset, test graphs
tests/run_tests.js    Node test-suite (same engine.js)
tests/build_samples.js regenerates js/samples.js from data/
```

## Run locally

Open `index.html` in any browser — no build step, no server, no internet needed.

Tests (Node 18+):

```bash
node tests/run_tests.js          # human-readable
node tests/run_tests.js --json   # full results as JSON
```

## Publish on GitHub Pages

1. Create a new **public** repository on GitHub named `exam-scheduler` (no README).
2. Upload the files: on the empty repo page click **uploading an existing file**, drag the *contents* of this folder (so `index.html` sits at the top level), and **Commit changes**.
   Or, from a terminal inside this folder:
   ```bash
   git init && git add . && git commit -m "Exam timetable scheduler"
   git branch -M main
   git remote add origin https://github.com/ayush12182/exam-scheduler.git
   git push -u origin main
   ```
3. Repository **Settings → Pages → Build and deployment → Source: Deploy from a branch**, branch **main**, folder **/ (root)**, **Save**.
4. After about a minute the site is live at `https://ayush12182.github.io/exam-scheduler/`.

## Results on the supplied dataset

20 students, 60 registrations, 10 subject codes → |V| = 10, |E| = 33 (60 course pairs checked, 27 repeats merged).
Greedy, Welsh–Powell and DSATUR all use 6 slots. The clique {25CS2101, 25CS2103, 25CS2201, 25CS2302, 25CS2303, 25CS2304} proves χ(G) ≥ 6, so **χ(G) = 6 and the 6-slot timetable is optimal**.
