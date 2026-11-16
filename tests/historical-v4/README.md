# Frozen pre-V5 test records

These exact old tests describe the retired project methodology: ATR endpoint SNR,
generic BOS/CHOCH, Order Block/Breaker, protected-swing stops and five-bar pivots.
They are preserved as text for review and can be run against source commit
301db321d59ca9de453a2741a0de14997f892a23, not against the author-only V5 engine.

Current replacement checks are in v5-author-and-freshness.test.ts,
knowledge-detectors.test.ts and pa-v4-golden.test.ts. HTTP/PNG, provider validation,
pagination, causal evidence, publisher privacy and security tests remain active.
Retirement of these assertions is a methodology migration, not evidence that
the old functionality still works. V5 explicitly reports unsupported old fields.
