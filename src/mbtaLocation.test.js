import assert from 'node:assert/strict'
import test from 'node:test'

import {
  isBusRouteLabel,
  routeIdFromLabel,
  routeIdsFromLabel,
} from './mbtaLocation.js'

test('resolves Commuter Rail line labels to MBTA route IDs', () => {
  const cases = [
    ['Fairmount Line – Readville', 'CR-Fairmount'],
    ['Fall River/New Bedford Line – New Bedford', 'CR-NewBedford'],
    ['Fitchburg Line – Wachusett', 'CR-Fitchburg'],
    ['Framingham/Worcester Line – Worcester', 'CR-Worcester'],
    ['Franklin/Foxboro Line – Forge Park/495', 'CR-Franklin'],
    ['Greenbush Line – Greenbush', 'CR-Greenbush'],
    ['Haverhill Line – Haverhill', 'CR-Haverhill'],
    ['Kingston Line – Kingston', 'CR-Kingston'],
    ['Lowell Line – Lowell', 'CR-Lowell'],
    ['Needham Line – Needham Heights', 'CR-Needham'],
    ['Newburyport/Rockport Line – Rockport', 'CR-Newburyport'],
    ['Providence/Stoughton Line – Wickford Junction', 'CR-Providence'],
    ['Foxboro Event Service – Foxboro', 'CR-Foxboro'],
  ]

  cases.forEach(([label, expected]) => {
    assert.equal(routeIdFromLabel(label), expected)
  })
})

test('keeps existing subway and bus route matching', () => {
  assert.equal(routeIdFromLabel('Orange Line – Oak Grove'), 'Orange')
  assert.equal(routeIdFromLabel('66 – Nubian via Allston'), '66')
  assert.equal(routeIdFromLabel('Green Line – D, Riverside'), 'Green-D')
})

test('resolves either-or bus route labels to all route IDs', () => {
  assert.deepEqual(routeIdsFromLabel('23 or 28 – Ruggles'), ['23', '28'])
  assert.deepEqual(routeIdsFromLabel('23 or 28 - Ruggles'), ['23', '28'])
  assert.equal(routeIdFromLabel('23 or 28 – Ruggles'), '23')
})

test('isBusRouteLabel identifies single and either-or bus routes', () => {
  assert.equal(isBusRouteLabel('66 – Nubian via Allston'), true)
  assert.equal(isBusRouteLabel('23 or 28 – Ruggles'), true)
  assert.equal(isBusRouteLabel('Orange Line – Oak Grove'), false)
  assert.equal(isBusRouteLabel('Fairmount Line – Readville'), false)
})
