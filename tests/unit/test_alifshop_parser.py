from services.scraper.app.parsers.alifshop import AlifshopParser


def test_extract_specs_keeps_real_color_not_values_token() -> None:
    source = """
    <div class="border-b-[0.5px] border-light-surface-300 py-2">
      <div class="flex md:gap-4 gap-3">
        <p class="w-full text-sm md:text-md text-light-basic-300 max-w-[320px]">Цвет</p>
        <div class="text-sm md:text-md w-full whitespace-break-spaces"><span>Deep Blue</span></div>
      </div>
    </div>
    <div class="border-b-[0.5px] border-light-surface-300 py-2">
      <div class="flex md:gap-4 gap-3">
        <p class="w-full text-sm md:text-md text-light-basic-300 max-w-[320px]">Объем встроенной памяти</p>
        <div class="text-sm md:text-md w-full whitespace-break-spaces"><span>512ГБ</span></div>
      </div>
    </div>
    <script>
      {"name":"Цвет","values":[{"value":"Deep Blue"}]}
    </script>
    """

    specs = AlifshopParser._extract_specs(source)

    assert specs["Цвет"] == "Deep Blue"
    assert specs["color"] == "Deep Blue"
    assert specs["storage_gb"] == "512"


def test_extract_specs_does_not_generate_zero_ram_from_noise() -> None:
    source = """
    <div class="border-b-[0.5px] border-light-surface-300 py-2">
      <div class="flex md:gap-4 gap-3">
        <p class="w-full text-sm md:text-md text-light-basic-300 max-w-[320px]">Тип SIM-карты</p>
        <div class="text-sm md:text-md w-full whitespace-break-spaces"><span>eSIM</span></div>
      </div>
    </div>
    <script>{"id":0,"name":"values","slug":"test"}</script>
    """

    specs = AlifshopParser._extract_specs(source)

    assert "ram_gb" not in specs
