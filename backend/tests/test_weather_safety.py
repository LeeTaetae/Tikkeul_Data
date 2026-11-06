"""No live calls: all three official endpoints via MockTransport."""
from datetime import datetime
import asyncio

import httpx
import pytest

from app.errors import ApiError
from app.timeutil import KST
from app.weather.forecast import quantity,issue_time,parse_forecast
from app.weather.service import WeatherService
from app.upstream import Upstream
from tests.conftest import make_settings
from tests.test_weather import ok,item,SNOW,SEOUL,coded

NOW=datetime(2026,11,5,12,20,tzinfo=KST)

def forecast(cat,value,valid="1300",base="1100"):
    return {"baseDate":"20261105","baseTime":base,"fcstDate":"20261105","fcstTime":valid,"category":cat,"fcstValue":value}


@pytest.mark.parametrize("raw,unit,lo,hi,category",[
    ("강수없음","mm/h",0,0,"none"),("1.0mm 미만","mm/h",0,1,"less_than"),
    ("30.0~50.0mm","mm/h",30,50,"range"),("50.0mm 이상","mm/h",50,None,"at_least"),
    ("0.5cm 미만","cm/h",0,.5,"less_than"),("적설없음","cm/h",0,0,"none"),
    ("2.5","mm/h",2.5,2.5,"exact"),("-999","mm/h",None,None,"missing"),
    ("NaN","mm/h",None,None,"missing"),("unknown","mm/h",None,None,"missing"),
])
def test_quantity_retains_interval_without_invented_midpoint(raw,unit,lo,hi,category):
    q=quantity(raw,unit)
    assert (q["lower"],q["upper"],q["category"],q["unit"])==(lo,hi,category,unit)


def test_issue_times_publication_delay_midnight_and_hour_boundaries():
    assert issue_time(NOW,"ultra")==("20261105","1130")
    assert issue_time(NOW.replace(minute=50),"ultra")==("20261105","1230")
    assert issue_time(NOW,"village")==("20261105","1100")
    assert issue_time(NOW.replace(hour=2,minute=10),"village")==("20261104","2300")
    assert issue_time(NOW.replace(hour=0,minute=10),"ultra")==("20261104","2330")


def test_forecast_is_not_observation_and_snow_units_and_times_are_preserved():
    p=parse_forecast(ok(forecast("PTY","3"),forecast("TMP","-2"),forecast("PCP","1mm 미만"),forecast("SNO","1.0~2.0cm")),"village")[0]
    assert p["kind"]=="forecast" and p["pty"]=="snow" and p["temp_c"]==-2
    assert p["valid_at"]=="2026-11-05T13:00:00+09:00"
    assert p["snow"]["unit"]=="cm/h" and p["rain"]["category"]=="less_than"
    assert parse_forecast(coded("03"),"ultra")==[]


@pytest.mark.parametrize("data",[{}, {"response":None},{"response":{"header":None}}, {"response":{"header":{"resultCode":"00"},"body":None}}])
def test_malformed_forecast_is_not_clear_weather(data):
    with pytest.raises(ApiError):parse_forecast(data,"village")


def test_all_three_sources_cache_separately_and_send_grid_not_gps():
    async def run():
        requests=[]
        def respond(request):
            requests.append(request)
            return httpx.Response(200,json=SNOW if request.url.path.endswith("getUltraSrtNcst") else ok(forecast("PTY","3"),forecast("TMP","-1"),forecast("PCP","1mm 미만"),forecast("SNO","1cm")))
        async with httpx.AsyncClient(transport=httpx.MockTransport(respond)) as http:
            service=WeatherService(Upstream(http,make_settings(kma_service_key="test-key",kma_min_interval_s=0)),make_settings(kma_min_interval_s=0),clock=lambda:NOW)
            first=await service.safety_weather(**{"lat":SEOUL["lat"],"lon":SEOUL["lon"]})
            await service.safety_weather(SEOUL["lat"],SEOUL["lon"])
        assert len(requests)==3
        assert {r.url.path.rsplit('/',1)[-1] for r in requests}=={"getUltraSrtNcst","getUltraSrtFcst","getVilageFcst"}
        assert all("lat" not in r.url.params and r.url.params["nx"]=="60" for r in requests)
        assert first["observation"]["status"]=="available"
        assert first["ultra_forecast"]["data_kind"]=="forecast"
        assert first["road_surface_observed"] is False
    asyncio.run(run())


def test_endpoint_missing_key_reports_unavailable_and_negative_caches(make_client):
    calls=[]
    c=make_client(lambda r:calls.append(r),make_settings(kma_min_interval_s=0))
    for _ in range(2):
        r=c.get('/api/weather/safety',params=SEOUL)
        assert r.status_code==200
        assert all(r.json()[p]["status"]=="unavailable" for p in ['observation','ultra_forecast','village_forecast'])
        assert r.json()['observation']['error_code']=='NOT_CONFIGURED'
    assert not calls


def test_partial_failure_and_stale_observation_remain_distinct():
    async def run():
        calls=[]
        def respond(request):
            calls.append(request)
            if request.url.path.endswith('getUltraSrtNcst'):return httpx.Response(200,json=ok(item('T1H',1,base_time='1000'),item('RN1',2,base_time='1000'),item('PTY',1,base_time='1000')))
            raise httpx.ReadTimeout('redacted',request=request)
        async with httpx.AsyncClient(transport=httpx.MockTransport(respond)) as http:
            s=make_settings(kma_service_key='test-key',kma_min_interval_s=0)
            service=WeatherService(Upstream(http,s),s,clock=lambda:NOW)
            result=await service.safety_weather(**SEOUL)
            await service.safety_weather(**SEOUL)
        assert len(calls)==3
        assert result['observation']['status']=='stale'
        assert result['ultra_forecast']['status']=='unavailable'
        assert result['ultra_forecast']['error_code']=='UPSTREAM_TIMEOUT'
    asyncio.run(run())


def test_nowcast_category_preserved_without_midpoint_and_actual_size_missing(make_client):
    c=make_client(lambda r:httpx.Response(200,json=ok(item('PTY',1),item('T1H',4),item('RN1','1mm 미만'))),make_settings(kma_service_key='test-key',kma_min_interval_s=0))
    data=c.get('/api/weather/safety',params=SEOUL).json()['observation']['data']
    assert data['rain_mm_1h'] is None
    assert data['rain']['category']=='less_than' and data['rain']['lower']==0 and data['rain']['upper']==1
