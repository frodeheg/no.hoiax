# Make backup
cp .homeycompose/app.json .homeycompose/app.json.bak
sed -i 's/"no.hoiax"/"no.hoiax2"/g' .homeycompose/app.json
sed -i 's/"Høiax"/"Høiax 2"/g' .homeycompose/app.json
