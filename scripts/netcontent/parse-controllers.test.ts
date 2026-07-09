import { describe, it, expect } from 'vitest';
import { parseControllerSource, parseParams } from './parse-controllers';

const SAMPLE = `
using Microsoft.AspNetCore.Mvc;
namespace DMO.NetContent2.Controllers {
  [ApiController]
  public class NccTareCheckController : ControllerBase {
    [HttpGet]
    [Route("api/NetContentTareCheck/GetCorrectiveActions")]
    public object GetCorrectiveActions() { return null; }

    [HttpGet]
    [Route("api/NetContentTareCheck/GetLastOpenTareCheck")]
    public object GetLastOpenTareCheck(int equipmentRowId, bool isTrayWeightCapture = false) { return null; }

    [HttpPost]
    [Route("api/NetContentTareCheck/UpdateMeasurement")]
    public void UpdateMeasurement(int valueRowId, double value, string comment, bool isManual = false) { }
  }
}
`;

describe('parseParams', () => {
  it('extracts name, type, required flag and default', () => {
    expect(parseParams('int equipmentRowId, bool isTrayWeightCapture = false')).toEqual([
      { name: 'equipmentRowId', csType: 'int', required: true, defaultValue: null },
      { name: 'isTrayWeightCapture', csType: 'bool', required: false, defaultValue: 'false' },
    ]);
  });

  it('returns [] for an empty signature', () => {
    expect(parseParams('')).toEqual([]);
    expect(parseParams('   ')).toEqual([]);
  });
});

describe('parseControllerSource', () => {
  it('extracts every routed action with method, route and params', () => {
    const { endpoints } = parseControllerSource(SAMPLE, 'TareCheck');
    expect(endpoints).toHaveLength(3);

    expect(endpoints[0]).toEqual({
      httpMethod: 'GET',
      route: 'api/NetContentTareCheck/GetCorrectiveActions',
      controller: 'TareCheck',
      action: 'GetCorrectiveActions',
      params: [],
    });

    expect(endpoints[1].httpMethod).toBe('GET');
    expect(endpoints[1].action).toBe('GetLastOpenTareCheck');
    expect(endpoints[1].params).toEqual([
      { name: 'equipmentRowId', csType: 'int', required: true, defaultValue: null },
      { name: 'isTrayWeightCapture', csType: 'bool', required: false, defaultValue: 'false' },
    ]);

    expect(endpoints[2].httpMethod).toBe('POST');
    expect(endpoints[2].action).toBe('UpdateMeasurement');
    expect(endpoints[2].params.map(p => p.name)).toEqual(['valueRowId', 'value', 'comment', 'isManual']);
  });
});
