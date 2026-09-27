#!/bin/sh
set -e
node validate_build.js
cat 01_head.html 02_body.html \
    10_data_a.js 11_data_b.js 12_data_c.js 13_data_d.js 14_data_e.js 15_data_f.js \
    16_data_interview.js 17_data_faults.js 18_data_clusters.js 19_data_diffs.js \
    1b_data_extensions.js 1b_data_topics.js 20_app.js 40_graph.js \
    > embedded-c-roadmap.html
echo "Built embedded-c-roadmap.html"
