document.addEventListener('DOMContentLoaded', function() {
    var chartElement = document.getElementById('taskStatusChart');
    if (chartElement) {
        var labels = JSON.parse(chartElement.dataset.labels);
        var data = JSON.parse(chartElement.dataset.values);
        initTaskStatusChart(chartElement, labels, data);
    }
});

function initTaskStatusChart(element, labels, data) {
    var ctx = element.getContext('2d');
    var taskStatusChart = new Chart(ctx, {
        type: 'pie',
        data: {
            labels: labels,
            datasets: [{
                data: data,
                backgroundColor: [
                    'rgba(255, 99, 132, 0.8)',
                    'rgba(54, 162, 235, 0.8)',
                    'rgba(255, 206, 86, 0.8)',
                    'rgba(75, 192, 192, 0.8)',
                    'rgba(153, 102, 255, 0.8)'
                ]
            }]
        },
        options: {
            responsive: true,
            plugins: {
                title: {
                    display: true,
                    text: 'Tasks by Status'
                }
            }
        }
    });
}
