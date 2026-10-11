---
layout: default
title: About
permalink: /about/
---
# About

I'm Pranav. I work in Strategy & Investments at A1 Apps, where I work on business performance, financial analysis and strategic initiatives.

I'm drawn to how businesses work: business models, competitive advantage, unit economics and capital allocation. The sectors I follow most closely are healthcare, consumer technology, fintech and renewable energy.

Outside of that, I'm interested in technology and AI and how they change both businesses and human behaviour. I like building practical tools, usually with Python or as small browser extensions, to fix problems I run into. And I spend time on philosophy and broader questions about how we think and live.

This site is a living record of all of that. Writing here is a way to think more clearly, so you'll find unfinished notes alongside more considered pieces. Each is labelled for what it is.

## Elsewhere

{% if site.email and site.email != "" %}- Email: [{{ site.email }}](mailto:{{ site.email }}){% endif %}
{% if site.linkedin and site.linkedin != "" %}- [LinkedIn]({{ site.linkedin }}){% endif %}
{% if site.github and site.github != "" %}- [GitHub]({{ site.github }}){% endif %}
{% if site.substack and site.substack != "" %}- [Substack]({{ site.substack }}){% endif %}
{% unless site.email != "" or site.linkedin != "" or site.github != "" %}Links coming soon.{% endunless %}
